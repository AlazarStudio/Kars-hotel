import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { tenantDeleteSwitch } from './tenant-delete.switch';

/* УХОД ГОСТИНИЦЫ ИЗ PMS (152-ФЗ, Г-22, ГС-09; план 13.8).
 *
 * Две ступени, обе — только суперадмин платформы (25.10.2026 днём были
 * открыты и диспетчеру, вечером владелец вернул как было: уничтожение стирает
 * данные). Пустую гостиницу, без броней, удаляет сразу `deleteEmpty` — он
 * выключен (`tenant-delete.switch.ts`), пока удаление не станет «в архив»:
 *  1. ВЫГРУЗКА — все строки всех таблиц с tenant_id одним JSON (гостинице —
 *     её данные). Секреты вырезаются: хеши паролей и токенов, ключ отчётов.
 *     В акт — время, кто и контрольная сумма файла.
 *  2. УНИЧТОЖЕНИЕ — только у выключенной гостиницы, при выгрузке не старше
 *     7 дней и после ввода её кода. Строки всех её таблиц (каскада от tenant
 *     нет: брони, номера, счета ссылаются на гостиницу без внешнего ключа),
 *     её журнал и файлы в хранилище. В акт — сколько строк в каких таблицах.
 *
 * Список таблиц берётся из схемы базы (столбец tenant_id), а не из кода:
 * новая таблица гостиницы не останется забытой. */

const SECRET_COLUMNS = ['password_hash', 'token_hash', 'key', 'key_hash'];
const EXPORT_FRESH_DAYS = 7;
/** Вместо контрольной суммы выгрузки в акте удаления пустой гостиницы: выгрузки не было. */
export const EMPTY_HOTEL_MARK = 'empty-hotel:no-export';

@Injectable()
export class TenantExitService {
  private readonly logger = new Logger(TenantExitService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  private async tenantTables(): Promise<string[]> {
    const rows = await this.prisma.admin.$queryRaw<Array<{ table_name: string }>>`
      SELECT c.table_name FROM information_schema.columns c
        JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
       WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND t.table_type = 'BASE TABLE'
         AND c.table_name <> 'tenant_exit_act'
       ORDER BY c.table_name`;
    // Имена — из схемы и только [a-z_]: безопасно подставлять как идентификатор.
    return rows.map((r) => r.table_name).filter((n) => /^[a-z_]+$/.test(n));
  }

  /** Таблицы без tenant_id со ссылкой (одностолбцовой) на таблицу гостиницы. */
  private async dependents(tx: { $queryRaw: PrismaService['$queryRaw'] }, tables: string[]) {
    const rows = await tx.$queryRaw<Array<{ child: string; col: string; parent: string; pcol: string }>>`
      SELECT c.conrelid::regclass::text AS child, a.attname AS col,
             c.confrelid::regclass::text AS parent, af.attname AS pcol
        FROM pg_constraint c
        JOIN pg_attribute a  ON a.attrelid = c.conrelid  AND a.attnum = c.conkey[1]
        JOIN pg_attribute af ON af.attrelid = c.confrelid AND af.attnum = c.confkey[1]
       WHERE c.contype = 'f' AND array_length(c.conkey, 1) = 1
         AND c.confrelid::regclass::text = ANY(${tables}::text[])
         AND NOT (c.conrelid::regclass::text = ANY(${tables}::text[]))`;
    return rows.filter((r) => [r.child, r.col, r.parent, r.pcol].every((n) => /^[a-z_]+$/.test(n)));
  }

  private async tenantOr404(id: string) {
    const t = await this.prisma.admin.tenant.findUnique({ where: { id } });
    if (!t || t.slug === 'platform') throw new NotFoundException('Гостиница не найдена');
    return t;
  }

  async export(tenantId: string, actorId: string): Promise<{ fileName: string; json: string }> {
    const tenant = await this.tenantOr404(tenantId);
    const tables: Record<string, unknown[]> = {};
    for (const t of await this.tenantTables()) {
      const rows = await this.prisma.admin.$queryRawUnsafe<Array<{ row: Record<string, unknown> }>>(
        `SELECT row_to_json(x) AS row FROM "${t}" x WHERE x.tenant_id = $1::uuid`,
        tenantId,
      );
      tables[t] = rows.map(({ row }) => {
        for (const c of SECRET_COLUMNS) if (c in row) delete row[c];
        return row;
      });
    }
    const { id, slug, name } = tenant;
    const json = JSON.stringify({ exportedAt: new Date().toISOString(), tenant: { ...tenant }, tables }, null, 2);
    const sha = createHash('sha256').update(json).digest('hex');
    await this.prisma.admin.tenantExitAct.create({
      data: { tenantId: id, tenantSlug: slug, tenantName: name, exportedBy: actorId, exportSha256: sha },
    });
    await this.prisma.writeAuditLog({
      tenantId: id,
      userId: actorId,
      entity: 'tenant',
      entityId: id,
      action: 'exit.export',
      diff: { before: {}, after: { sha256: sha } },
    });
    return { fileName: `hotel-${slug}-${new Date().toISOString().slice(0, 10)}.json`, json };
  }

  async destroy(tenantId: string, confirmSlug: string | undefined, actorId: string) {
    const tenant = await this.tenantOr404(tenantId);
    if ((confirmSlug ?? '').trim() !== tenant.slug) {
      throw new BadRequestException('Для подтверждения введите код гостиницы');
    }
    if (tenant.isActive) throw new ConflictException('Сначала выключите гостиницу');
    const act = await this.prisma.admin.tenantExitAct.findFirst({
      where: { tenantId, destroyedAt: null, exportedAt: { gte: new Date(Date.now() - EXPORT_FRESH_DAYS * 86_400_000) } },
      orderBy: { exportedAt: 'desc' },
    });
    if (!act) throw new ConflictException(`Сначала выгрузите данные гостиницы (выгрузка не старше ${EXPORT_FRESH_DAYS} дней)`);

    const tables = await this.tenantTables();
    let counts: Record<string, number> = {};
    await this.prisma.admin.$transaction(
      async (tx) => {
        counts = await this.wipe(tx, tenantId, tables);
        await tx.tenantExitAct.update({
          where: { id: act.id },
          data: { destroyedAt: new Date(), destroyedBy: actorId, counts },
        });
      },
      { timeout: 120_000 },
    );
    const files = await this.deleteFiles(tenantId, tenant.slug);
    this.logger.log(`Гостиница ${tenant.slug} уничтожена по акту ${act.id}: ${JSON.stringify(counts)}, файлов ${files}`);
    return { actId: act.id, counts, files };
  }

  /**
   * Удаление ПУСТОЙ гостиницы — без выгрузки (решение владельца 25.10.2026):
   * ошибочно заведённая, дубль, так и не начавшая работать.
   *
   * «Пустая» — ни одной брони, в любом статусе: на бронях держатся гости,
   * счета и оплаты, то есть персональные данные и деньги. Гостиница с
   * бронями — только прежним порядком: выключить, выгрузить, уничтожить по
   * акту. Номера, категории, цены, роли и учётки сотрудников уходят вместе с
   * пустой гостиницей — окно в панели называет, сколько их.
   *
   * Брони считаются в той же транзакции, что и стирание. След — акт ухода
   * (его таблица не стирается) с пометкой «пустая, без выгрузки» вместо
   * контрольной суммы: журнал гостиницы уходит вместе с ней.
   */
  async deleteEmpty(tenantId: string, actorId: string) {
    if (!tenantDeleteSwitch.enabled) {
      throw new ForbiddenException('Удаление гостиниц пока выключено');
    }
    const tenant = await this.tenantOr404(tenantId);
    const tables = await this.tenantTables();
    let counts: Record<string, number> = {};
    const act = await this.prisma.admin.$transaction(
      async (tx) => {
        const reservations = await tx.reservation.count({ where: { tenantId } });
        if (reservations > 0) {
          throw new ConflictException(
            `У гостиницы «${tenant.name}» есть брони (${reservations}) — сразу удалить нельзя. ` +
              'Гостиницу с данными удаляют по акту: выключить, выгрузить, уничтожить.',
          );
        }
        counts = await this.wipe(tx, tenantId, tables);
        return tx.tenantExitAct.create({
          data: {
            tenantId,
            tenantSlug: tenant.slug,
            tenantName: tenant.name,
            exportedBy: actorId,
            exportSha256: EMPTY_HOTEL_MARK,
            destroyedAt: new Date(),
            destroyedBy: actorId,
            counts,
          },
        });
      },
      { timeout: 120_000 },
    );
    const files = await this.deleteFiles(tenantId, tenant.slug);
    this.logger.log(`Пустая гостиница ${tenant.slug} удалена (акт ${act.id}): ${JSON.stringify(counts)}, файлов ${files}`);
    return { actId: act.id, counts, files };
  }

  /** Все строки гостиницы во всех её таблицах — внутри транзакции вызывающего. */
  private async wipe(
    tx: { $executeRawUnsafe: PrismaService['$executeRawUnsafe']; $queryRaw: PrismaService['$queryRaw'] },
    tenantId: string,
    tables: string[],
  ): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    // Порядок удаления не важен: внешние ключи на время транзакции молчат,
    // а уходит всё, что принадлежит гостинице, целиком.
    await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`);
    for (const t of tables) {
      counts[t] = await tx.$executeRawUnsafe(`DELETE FROM "${t}" WHERE tenant_id = $1::uuid`, tenantId);
    }
    counts.tenant = await tx.$executeRawUnsafe(`DELETE FROM "tenant" WHERE id = $1::uuid`, tenantId);
    /* Каскады при молчащих ключах тоже молчат: строки таблиц без tenant_id,
       висевшие на удалённых (права ролей гостиницы), стираем явно. Связи —
       из схемы базы, как и список таблиц. */
    for (const fk of await this.dependents(tx, tables)) {
      counts[`${fk.child} (связанные)`] = await tx.$executeRawUnsafe(
        `DELETE FROM "${fk.child}" x WHERE x."${fk.col}" IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM "${fk.parent}" p WHERE p."${fk.pcol}" = x."${fk.col}")`,
      );
    }
    return counts;
  }

  /** Файлы — после фиксации: откат не оставит строк, указывающих на стёртое. */
  private deleteFiles(tenantId: string, slug: string): Promise<number> {
    return this.storage.deleteTenantFiles(tenantId).catch((e: unknown) => {
      this.logger.error(`Файлы гостиницы ${slug} не стёрты: ${e instanceof Error ? e.message : String(e)}`);
      return -1;
    });
  }
}

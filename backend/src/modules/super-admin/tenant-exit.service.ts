import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';

/* УХОД ГОСТИНИЦЫ ИЗ PMS (152-ФЗ, Г-22, ГС-09; план 13.8).
 *
 * Две ступени, обе — суперадмин платформы:
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
    const counts: Record<string, number> = {};
    await this.prisma.admin.$transaction(
      async (tx) => {
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
        await tx.tenantExitAct.update({
          where: { id: act.id },
          data: { destroyedAt: new Date(), destroyedBy: actorId, counts },
        });
      },
      { timeout: 120_000 },
    );
    // Файлы — после фиксации: откат не оставит строк, указывающих на стёртое.
    const files = await this.storage.deleteTenantFiles(tenantId).catch((e: unknown) => {
      this.logger.error(`Файлы гостиницы ${tenant.slug} не стёрты: ${e instanceof Error ? e.message : String(e)}`);
      return -1;
    });
    this.logger.log(`Гостиница ${tenant.slug} уничтожена по акту ${act.id}: ${JSON.stringify(counts)}, файлов ${files}`);
    return { actId: act.id, counts, files };
  }
}

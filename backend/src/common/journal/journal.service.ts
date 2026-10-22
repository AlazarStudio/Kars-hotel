import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/* Журнал действий: запись — пачками, мимо запроса.
 *
 * Запись идёт на каждый запрос, меняющий данные, и на каждое нажатие —
 * отдельный INSERT на каждое замедлил бы всё. Строки копятся в памяти и
 * уходят одним createMany раз в секунду (или по сотне) admin-клиентом:
 * app_user к таблице доступа не имеет. Ошибка записи не роняет ответ —
 * только громкое предупреждение в вывод. Цена: при падении процесса
 * теряется последняя секунда. */

export type JournalRow = Prisma.ActionJournalCreateManyInput;

const FLUSH_MS = 1000;
const FLUSH_AT = 100;

export interface JournalQuery {
  tenantId?: string;
  userId?: string;
  kind?: string;
  sessionId?: string;
  actionId?: string;
  q?: string;
  failed?: string;
  from?: string;
  to?: string;
  before?: string;
  take?: number;
}

@Injectable()
export class JournalService implements OnModuleDestroy {
  private readonly log = new Logger('ActionJournal');
  private buf: JournalRow[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {}

  push(row: JournalRow): void {
    this.buf.push(row);
    if (this.buf.length >= FLUSH_AT) void this.flush();
    else if (!this.timer) this.timer = setTimeout(() => void this.flush(), FLUSH_MS);
  }

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.buf.length) return;
    const rows = this.buf;
    this.buf = [];
    try {
      await this.prisma.admin.actionJournal.createMany({ data: rows });
    } catch (err) {
      this.log.error(`action journal: ${rows.length} rows NOT written — ${(err as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.flush();
  }

  /* Читает только платформа (суперадмин и диспетчер Kars Avia) — по всем
     гостиницам; сама гостиница журнал не видит (решение владельца 23.10.2026). */
  async list(f: JournalQuery) {
    const where: Prisma.ActionJournalWhereInput = {};
    if (f.tenantId) where.tenantId = f.tenantId;
    if (f.userId) where.userId = f.userId;
    if (f.kind) where.kind = f.kind;
    if (f.sessionId) where.sessionId = f.sessionId;
    if (f.actionId) where.actionId = f.actionId;
    const at: Prisma.DateTimeFilter = {};
    if (f.from) at.gte = new Date(f.from);
    if (f.to) at.lte = new Date(f.to);
    if (f.before) at.lt = new Date(f.before);
    if (Object.keys(at).length) where.at = at;
    const and: Prisma.ActionJournalWhereInput[] = [];
    if (f.failed === '1') and.push({ OR: [{ status: { gte: 400 } }, { event: 'js-error' }] });
    if (f.q) {
      const q = f.q.trim();
      and.push({
        OR: [
          { label: { contains: q, mode: 'insensitive' } },
          { path: { contains: q, mode: 'insensitive' } },
          { page: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
          { error: { contains: q, mode: 'insensitive' } },
        ],
      });
    }
    if (and.length) where.AND = and;
    const take = Math.min(Math.max(Number(f.take) || 100, 1), 500);
    const rows = await this.prisma.admin.actionJournal.findMany({ where, orderBy: [{ at: 'desc' }, { id: 'desc' }], take });
    const userIds = [...new Set(rows.map((r) => r.userId).filter((x): x is string => !!x))];
    const tenantIds = [...new Set(rows.map((r) => r.tenantId).filter((x): x is string => !!x))];
    const [users, tenants] = await Promise.all([
      userIds.length
        ? this.prisma.admin.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } })
        : [],
      tenantIds.length
        ? this.prisma.admin.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true } })
        : [],
    ]);
    const userName = new Map(users.map((u) => [u.id, u.fullName]));
    const tenantName = new Map(tenants.map((t) => [t.id, t.name]));
    return {
      items: rows.map((r) => ({
        ...r,
        userName: r.userId ? (userName.get(r.userId) ?? null) : null,
        tenantName: r.tenantId ? (tenantName.get(r.tenantId) ?? null) : null,
      })),
      nextBefore: rows.length === take ? rows[rows.length - 1].at.toISOString() : null,
    };
  }
}

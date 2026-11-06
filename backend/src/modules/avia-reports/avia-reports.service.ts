import { BadGatewayException,
  BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Отчёты, выпущенные Kars Avia для ЭТОЙ гостиницы (01.10.2026, перенос
 * «Отчётов v2», кабинет гостиницы).
 *
 * В старой системе админ гостиницы видел свои отчёты в разделе «Отчёты» Авиа.
 * Пользователи гостиницы теперь живут здесь, в PMS, поэтому PMS забирает их
 * у партнёра: список и файл xlsx. Гостиница называется своим слагом и
 * предъявляет СВОЙ ключ (`X-Hotel-Key`, 152-ФЗ, план 11.3) — его присылает
 * партнёр; общий секрет вебхуков сюда больше не ходит. Ключ гостиницы А
 * у партнёра не открывает отчёты гостиницы Б, а слаг и ключ здесь берутся
 * из арендатора пользователя, не из запроса.
 */
export interface AviaReport {
  id: string;
  name: string;
  title: string | null;
  startDate: string;
  endDate: string;
  createdAt: string;
  archived: boolean;
}

@Injectable()
export class AviaReportsService {
  private static readonly TIMEOUT_MS = 10_000;

  constructor(private readonly prisma: PrismaService) {}

  /** Адрес ручки партнёра: явный `PARTNER_REPORTS_URL` или рядом с вебхуками. */
  private get base(): string {
    const explicit = process.env.PARTNER_REPORTS_URL ?? '';
    if (explicit) return explicit.replace(/\/+$/, '');
    const hook = process.env.PARTNER_WEBHOOK_URL ?? '';
    return hook ? hook.replace(/\/hotel\/webhooks\/?$/, '/hotel/connect/reports') : '';
  }

  private async slugOf(tenantId: string): Promise<string> {
    const rows = await this.prisma.admin.$queryRaw<{ slug: string }[]>`
      SELECT slug FROM tenant WHERE id = ${tenantId}::uuid LIMIT 1
    `;
    const slug = rows[0]?.slug;
    if (!slug) throw new NotFoundException('Гостиница не найдена');
    return slug;
  }

  /** Ключ гостиницы — его присылает Kars Avia при подключении кабинета. */
  private async keyOf(tenantId: string): Promise<string> {
    const row = await this.prisma.admin.aviaReportsKey.findUnique({ where: { tenantId } });
    if (!row) throw new ServiceUnavailableException('Kars Avia ещё не подключила отчёты для гостиницы');
    return row.key;
  }

  private async call(path: string, tenantId: string): Promise<Response> {
    if (!this.base) throw new ServiceUnavailableException('Связь с Kars Avia не настроена');
    const slug = await this.slugOf(tenantId);
    const key = await this.keyOf(tenantId);
    const sep = path.includes('?') ? '&' : '?';
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}${sep}hotelId=${encodeURIComponent(slug)}`, {
        headers: { 'X-Hotel-Key': key },
        signal: AbortSignal.timeout(AviaReportsService.TIMEOUT_MS),
      });
    } catch {
      throw new BadGatewayException('Kars Avia не отвечает');
    }
    if (res.status === 404) throw new NotFoundException('Отчёт не найден');
    if (!res.ok) throw new BadGatewayException(`Kars Avia ответила ${res.status}`);
    return res;
  }

  /* 4.2 · Отчёт по заявке ФАП: путь `/fap`, тот же ключ гостиницы. Текст отказа Авиа
     передаётся как есть: «счёт после утверждения» гостинице нужен дословно. */
  private async send(path: string, tenantId: string, init: RequestInit): Promise<unknown> {
    if (!this.base) throw new ServiceUnavailableException('Связь с Kars Avia не настроена');
    const slug = await this.slugOf(tenantId);
    const key = await this.keyOf(tenantId);
    let res: Response;
    try {
      res = await fetch(`${this.base}/fap${path}?hotelId=${encodeURIComponent(slug)}`, {
        ...init,
        headers: { ...(init.headers as Record<string, string> | undefined), 'X-Hotel-Key': key },
        signal: AbortSignal.timeout(AviaReportsService.TIMEOUT_MS),
      });
    } catch {
      throw new BadGatewayException('Kars Avia не отвечает');
    }
    if (res.status === 404) throw new NotFoundException('Заявка не найдена');
    if (res.status === 400) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      throw new BadRequestException(body?.message ?? 'Kars Avia не приняла данные');
    }
    if (!res.ok) throw new BadGatewayException(`Kars Avia ответила ${res.status}`);
    return res.json();
  }

  fapList(tenantId: string) {
    return this.send('', tenantId, { method: 'GET' });
  }

  fapReport(tenantId: string, fapHotelId: string) {
    return this.send(`/${encodeURIComponent(fapHotelId)}`, tenantId, { method: 'GET' });
  }

  fapSave(tenantId: string, fapHotelId: string, rows: unknown[]) {
    return this.send(`/${encodeURIComponent(fapHotelId)}`, tenantId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows }),
    });
  }

  fapInvoice(tenantId: string, fapHotelId: string, file: { buffer: Buffer; originalname: string }, amount: string, number?: string) {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(file.buffer)], { type: 'application/pdf' }), file.originalname);
    form.append('amount', amount);
    if (number) form.append('number', number);
    return this.send(`/${encodeURIComponent(fapHotelId)}/invoice`, tenantId, { method: 'POST', body: form });
  }

  async list(tenantId: string): Promise<AviaReport[]> {
    const res = await this.call('', tenantId);
    return (await res.json()) as AviaReport[];
  }

  async file(tenantId: string, id: string): Promise<{ buffer: Buffer; name: string }> {
    const res = await this.call(`/${encodeURIComponent(id)}/file`, tenantId);
    const disposition = res.headers.get('content-disposition') ?? '';
    const name = /filename="?([^"]+)"?/.exec(disposition)?.[1] ?? 'report.xlsx';
    return { buffer: Buffer.from(await res.arrayBuffer()), name };
  }
}

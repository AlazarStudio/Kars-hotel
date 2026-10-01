import { BadGatewayException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Отчёты, выпущенные Kars Avia для ЭТОЙ гостиницы (01.10.2026, перенос
 * «Отчётов v2», кабинет гостиницы).
 *
 * В старой системе админ гостиницы видел свои отчёты в разделе «Отчёты» Авиа.
 * Пользователи гостиницы теперь живут здесь, в PMS, поэтому PMS забирает их
 * у партнёра: список и файл xlsx. Канал тот же, что у вебхуков (общий
 * секрет PMS → партнёр), гостиница называется своим слагом — у партнёра это
 * её идентификатор. Чужих отчётов партнёр не отдаёт: отбор по слагу на его
 * стороне, а слаг здесь берётся из арендатора пользователя, не из запроса.
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

  private get secret(): string {
    return process.env.PARTNER_WEBHOOK_SECRET ?? '';
  }

  private async slugOf(tenantId: string): Promise<string> {
    const rows = await this.prisma.admin.$queryRaw<{ slug: string }[]>`
      SELECT slug FROM tenant WHERE id = ${tenantId}::uuid LIMIT 1
    `;
    const slug = rows[0]?.slug;
    if (!slug) throw new NotFoundException('Гостиница не найдена');
    return slug;
  }

  private async call(path: string, tenantId: string): Promise<Response> {
    if (!this.base || !this.secret) throw new ServiceUnavailableException('Связь с Kars Avia не настроена');
    const slug = await this.slugOf(tenantId);
    const sep = path.includes('?') ? '&' : '?';
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}${sep}hotelId=${encodeURIComponent(slug)}`, {
        headers: { 'X-Webhook-Secret': this.secret },
        signal: AbortSignal.timeout(AviaReportsService.TIMEOUT_MS),
      });
    } catch {
      throw new BadGatewayException('Kars Avia не отвечает');
    }
    if (res.status === 404) throw new NotFoundException('Отчёт не найден');
    if (!res.ok) throw new BadGatewayException(`Kars Avia ответила ${res.status}`);
    return res;
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

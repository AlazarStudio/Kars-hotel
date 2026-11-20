import { Controller, Get, Req, Res, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Public } from '../auth/decorators/public.decorator';

/* Адреса PMS по убыванию приоритета (20.11.2026, как у Авии — связка доменов):
 * основной, резервный, зеркало. Страница не-основного адреса спрашивает тех,
 * кто главнее, и уходит на первый живой. Только origin, мусор отброшен. */
export function karsOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const list: string[] = [];
  for (const raw of (env.KARS_ORIGINS ?? '').split(',')) {
    try {
      const u = new URL(raw.trim());
      if ((u.protocol === 'https:' || u.protocol === 'http:') && !list.includes(u.origin)) list.push(u.origin);
    } catch {
      /* не адрес — пропускаем */
    }
  }
  return list;
}

/* Живость для редиректа — под /api: `/health` вне префикса снаружи уходит во
 * фронт (Caddy), и тот отвечает 200 при лежащем API. «Жив» — API и база.
 * Читать с другого адреса браузер даст только по CORS: заголовок — лишь
 * адресам из списка и без cookie (ответ одинаков для всех). */
@ApiTags('health')
@Public()
@Controller('domains')
export class DomainsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Живость адреса и список адресов PMS по приоритету' })
  async status(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<{ ok: true; origins: string[] }> {
    const origins = karsOrigins();
    const origin = req.headers.origin;
    if (origin && origins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Cache-Control', 'no-store');
    try {
      await this.prisma.ping();
    } catch {
      throw new ServiceUnavailableException();
    }
    return { ok: true, origins };
  }
}

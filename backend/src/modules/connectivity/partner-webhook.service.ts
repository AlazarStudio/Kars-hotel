import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Исходящие вебхуки партнёру (Kars Avia).
 *
 * Партнёр создаёт бронь через connectivity-API и до сих пор узнавал её судьбу
 * только опросом: диспетчер открывал заявку и жал «обновить факты». Отель уже
 * знает, что гость заехал, — пусть говорит сам.
 *
 * Три решения, определяющие всё остальное:
 *
 *  1. Шлём ТОЛЬКО по броням партнёра (`channel_managed = true`). Собственные
 *     брони отеля партнёру не сопоставить: у него нет соответствующей заявки,
 *     и каждое такое событие превратилось бы в запись об ошибке на его стороне.
 *  2. Отправка не в транзакции и не блокирует ответ пользователю. Заселение
 *     гостя не должно падать оттого, что у партнёра лежит сеть; сорвавшийся
 *     вебхук — это задержка факта, а не потеря: pull-эндпоинт
 *     `GET /reservations/:id/facts` остаётся источником правды.
 *  3. Свой id доставки на каждое событие. Партнёр по нему делает приём
 *     идемпотентным, поэтому ретраи безопасны — и поэтому же id генерится
 *     ОДИН раз на событие, а не на попытку.
 */

export type PartnerWebhookType =
  | 'reservation.confirmed'
  | 'reservation.changed'
  | 'reservation.cancelled'
  | 'guest.checked_in'
  | 'guest.checked_out'
  | 'guest.no_show';

@Injectable()
export class PartnerWebhookService {
  private readonly log = new Logger(PartnerWebhookService.name);

  // Три попытки с нарастающей паузой: переживает перезапуск партнёра, но не
  // держит соединение вечно.
  private static readonly RETRY_DELAYS_MS = [0, 2_000, 10_000];
  private static readonly TIMEOUT_MS = 5_000;

  constructor(private readonly prisma: PrismaService) {}

  private get url(): string {
    return process.env.PARTNER_WEBHOOK_URL ?? '';
  }

  private get secret(): string {
    return process.env.PARTNER_WEBHOOK_SECRET ?? '';
  }

  /**
   * Отправить событие по брони, если она партнёрская. Никогда не бросает:
   * вызывается из доменных операций, ронять которые нельзя.
   */
  async emitForReservation(
    type: PartnerWebhookType,
    reservationId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (!this.url || !this.secret) return; // интеграция не настроена
    try {
      const rows = await this.prisma.admin.$queryRaw<{ channel_managed: boolean; slug: string }[]>`
        SELECT r.channel_managed, t.slug
        FROM reservation r
        JOIN tenant t ON t.id = r.tenant_id
        WHERE r.id = ${reservationId}::uuid
        LIMIT 1
      `;
      const row = rows[0];
      if (!row?.channel_managed) return; // своя бронь отеля — партнёру не нужна
      void this.deliver(type, row.slug, payload);
    } catch (e) {
      this.log.warn(
        `Не удалось подготовить вебхук ${type} по брони ${reservationId}: ${(e as Error).message}`,
      );
    }
  }

  /** Доставка с ретраями. Живёт в фоне — результат никого не блокирует. */
  private async deliver(
    type: PartnerWebhookType,
    hotelSlug: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const envelope = {
      // Один id на событие, а не на попытку: партнёр по нему отсекает дубли.
      id: randomUUID(),
      type,
      hotelId: hotelSlug,
      occurredAt: new Date().toISOString(),
      payload,
    };

    for (let attempt = 0; attempt < PartnerWebhookService.RETRY_DELAYS_MS.length; attempt++) {
      const delay = PartnerWebhookService.RETRY_DELAYS_MS[attempt];
      if (delay) await new Promise((r) => setTimeout(r, delay));
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), PartnerWebhookService.TIMEOUT_MS);
        const res = await fetch(this.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Secret': this.secret,
          },
          body: JSON.stringify(envelope),
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (res.ok) {
          this.log.log(`Вебхук ${type} доставлен партнёру (${hotelSlug})`);
          return;
        }
        /* 4xx — партнёр событие не примет и на повторе: неверный секрет,
         * незнакомый тип. Долбиться бессмысленно, пишем в лог и выходим. */
        if (res.status >= 400 && res.status < 500) {
          this.log.warn(`Вебхук ${type} отклонён партнёром (${res.status}) — повтор не поможет`);
          return;
        }
      } catch (e) {
        this.log.warn(
          `Вебхук ${type}: попытка ${attempt + 1} не удалась — ${(e as Error).message}`,
        );
      }
    }
    // Факты партнёр всё равно доберёт опросом — поэтому это предупреждение,
    // а не ошибка.
    this.log.warn(
      `Вебхук ${type} по гостинице ${hotelSlug} не доставлен; партнёр получит факты опросом`,
    );
  }
}

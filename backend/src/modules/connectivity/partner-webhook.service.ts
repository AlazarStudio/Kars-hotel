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
  | 'guest.no_show'
  | 'tariff.changed';

export interface TariffMeta {
  id: string;
  code: string;
  name: string;
  partnerId: string | null;
  reviewVerdict: string | null;
  slug: string;
}

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

  /* БРОНЬ ИЗМЕНЕНА — одним местом и в формате договора (30.09.2026, Э9).
   *
   * Раньше событие слал только путь партнёра (connectivity), и сырым
   * форматом PMS: `reservationId` вместо `id`, статус заглавными. Приёмник
   * Авии искал бронь по `id` — и ни одно «изменена» не находило размещения.
   * А правки самой гостиницы (перенесла даты, переселила в другой номер на
   * шахматке) не сообщались вовсе. Теперь правку брони партнёра сообщает
   * сама правка — откуда бы она ни пришла, — и одним форматом. */
  async emitReservationChanged(reservationId: string): Promise<void> {
    if (!this.url || !this.secret) return;
    try {
      const rows = await this.prisma.admin.$queryRaw<
        {
          id: string;
          status: string;
          check_in: Date;
          check_out: Date;
          room_id: string | null;
          room_number: string | null;
          version: number;
          channel_managed: boolean;
          slug: string;
        }[]
      >`
        SELECT r.id, r.status::text AS status, r.check_in, r.check_out, r.room_id,
               rm.number AS room_number, r.version, r.channel_managed, t.slug
        FROM reservation r
        JOIN tenant t ON t.id = r.tenant_id
        LEFT JOIN room rm ON rm.id = r.room_id
        WHERE r.id = ${reservationId}::uuid
        LIMIT 1
      `;
      const r = rows[0];
      if (!r?.channel_managed) return;
      const day = (d: Date) => d.toISOString().slice(0, 10);
      void this.deliver('reservation.changed', r.slug, {
        id: r.id,
        reservationId: r.id,
        status: r.status.toLowerCase(),
        checkIn: day(r.check_in),
        checkOut: day(r.check_out),
        roomId: r.room_id,
        roomNumber: r.room_number,
        version: r.version,
      });
    } catch (e) {
      this.log.warn(`Не удалось подготовить вебхук reservation.changed по брони ${reservationId}: ${(e as Error).message}`);
    }
  }

  /* ТАРИФ ПАРТНЁРА ИЗМЕНЁН (30.09.2026, Э9).
   *
   * Правка цен, условий или выключение корпоративного тарифа роняет его
   * подтверждение (отпечаток сверки), а партнёр узнавал об этом, только
   * открыв панель. Теперь гостиница говорит сама. Только по тарифу, который
   * уже сверяли (подтверждён или отклонён): правки черновика никого не
   * касаются, а шум приучает не читать. */
  async planMeta(ratePlanId: string): Promise<TariffMeta | null> {
    try {
      const rows = await this.prisma.admin.$queryRaw<TariffMeta[]>`
        SELECT rp.id, rp.code, rp.name, rp.partner_id AS "partnerId",
               rp.review_verdict::text AS "reviewVerdict", t.slug
        FROM rate_plan rp
        JOIN tenant t ON t.id = rp.tenant_id
        WHERE rp.id = ${ratePlanId}::uuid
        LIMIT 1
      `;
      return rows[0] ?? null;
    } catch {
      return null;
    }
  }

  async emitTariffChanged(
    meta: TariffMeta | null,
    change: 'prices' | 'conditions' | 'removed',
  ): Promise<void> {
    if (!this.url || !this.secret || !meta?.partnerId || !meta.reviewVerdict) return;
    void this.deliver('tariff.changed', meta.slug, {
      ratePlanId: meta.id,
      code: meta.code,
      name: meta.name,
      change,
    });
  }

  /** То же по id — для правок, после которых тариф ещё существует. */
  async emitForRatePlan(ratePlanId: string, change: 'prices' | 'conditions'): Promise<void> {
    if (!this.url || !this.secret) return;
    await this.emitTariffChanged(await this.planMeta(ratePlanId), change);
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

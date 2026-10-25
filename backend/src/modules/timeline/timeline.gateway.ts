import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtAccessPayload } from '../auth/types/jwt-payload';

/**
 * WebSocket gateway for real-time timeline updates.
 *
 * Clients subscribe to a tenant-scoped room: `timeline:{tenantId}`.
 * When a reservation is created / updated / deleted, the service that
 * performs the mutation calls `TimelineGateway.notifyUpdate(tenantId)`.
 * All connected clients in that room receive a `timeline:update` event
 * and re-fetch the timeline.
 *
 * Вход: клиент шлёт access-токен в `handshake.auth.token`. Гостиница комнаты —
 * `tid` ПРОВЕРЕННОГО токена (тот же секрет и те же обязательные поля, что у
 * `jwt.strategy.ts`); без токена, с битой подписью или истёкшим — отключаем,
 * ни в какую комнату сокет не попадает. Что клиент пишет в handshake про
 * гостиницу, не читается вовсе: до 25.10.2026 здесь стоял этот же комментарий,
 * а код сажал в комнату по `auth.tenantId` клиента — любой, кто знал id
 * гостиницы, получал её `timeline:update`.
 *
 * Токен проверяется при подключении: сокет переживает срок access-токена, а
 * кабинет переподключается с новым при каждой его смене (`useTimeline`).
 */
@WebSocketGateway({
  cors: {
    origin: '*', // tightened per-tenant in production; dev is open
    credentials: true,
  },
  namespace: '/timeline',
})
export class TimelineGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(TimelineGateway.name);
  private readonly accessSecret: string;

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.accessSecret = config.getOrThrow<string>('JWT_ACCESS_SECRET');
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  handleConnection(client: Socket): void {
    const tenantId = this.verifiedTenantId(client.handshake.auth?.token);
    if (!tenantId) {
      this.logger.warn(`WS connection rejected (no valid token): ${client.id}`);
      client.disconnect(true);
      return;
    }

    const room = `timeline:${tenantId}`;
    void client.join(room);
    this.logger.debug(`WS connected: ${client.id} → room ${room}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`WS disconnected: ${client.id}`);
  }

  /** Гостиница из access-токена — или null, если токену верить нельзя. */
  private verifiedTenantId(token: unknown): string | null {
    if (typeof token !== 'string' || !token) return null;
    try {
      const payload = this.jwt.verify<JwtAccessPayload>(token, { secret: this.accessSecret });
      return payload?.sub && payload?.tid ? payload.tid : null;
    } catch {
      return null;
    }
  }

  // ── Messages ──────────────────────────────────────────────────────────────

  /**
   * Client pings to confirm it's in the correct room.
   * Returns the room names the client has joined.
   */
  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() client: Socket): string[] {
    return Array.from(client.rooms);
  }

  // ── Server-side push ──────────────────────────────────────────────────────

  /**
   * Called by ReservationsService (Phase H) when a reservation is mutated.
   * Broadcasts `timeline:update` to all clients subscribed to this tenant.
   *
   * Payload intentionally minimal — clients refetch the full timeline.
   */
  notifyUpdate(
    tenantId: string,
    payload: { reservationId?: string; action: 'created' | 'updated' | 'deleted' },
  ): void {
    const room = `timeline:${tenantId}`;
    this.server.to(room).emit('timeline:update', {
      tenantId,
      ...payload,
      at: new Date().toISOString(),
    });
    this.logger.debug(`timeline:update → room ${room}, action=${payload.action}`);
  }
}

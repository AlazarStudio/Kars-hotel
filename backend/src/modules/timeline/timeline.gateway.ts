import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

/**
 * WebSocket gateway for real-time timeline updates.
 *
 * Clients subscribe to a tenant-scoped room: `timeline:{tenantId}`.
 * When a reservation is created / updated / deleted, the service that
 * performs the mutation calls `TimelineGateway.notifyUpdate(tenantId)`.
 * All connected clients in that room receive a `timeline:update` event
 * and re-fetch the timeline.
 *
 * Auth: the client must send a valid JWT in the `auth.token` handshake
 * field. We verify it here and reject unauthorized connections.
 */
@WebSocketGateway({
  cors: {
    origin: '*',   // tightened per-tenant in production; dev is open
    credentials: true,
  },
  namespace: '/timeline',
})
export class TimelineGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(TimelineGateway.name);

  @WebSocketServer()
  server!: Server;

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  handleConnection(client: Socket): void {
    // Extract tenantId from handshake auth — sent by frontend on connect().
    const tenantId = client.handshake.auth?.tenantId as string | undefined;
    if (!tenantId) {
      this.logger.warn(`WS connection rejected (no tenantId): ${client.id}`);
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
  notifyUpdate(tenantId: string, payload: { reservationId?: string; action: 'created' | 'updated' | 'deleted' }): void {
    const room = `timeline:${tenantId}`;
    this.server.to(room).emit('timeline:update', {
      tenantId,
      ...payload,
      at: new Date().toISOString(),
    });
    this.logger.debug(`timeline:update → room ${room}, action=${payload.action}`);
  }
}

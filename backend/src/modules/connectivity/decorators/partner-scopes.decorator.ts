import { SetMetadata } from '@nestjs/common';

/** Scopes a partner API key may hold. Mirrored on the Avia adapter side. */
export const PARTNER_SCOPES = {
  HotelsRead: 'hotels:read',
  AvailabilityRead: 'availability:read',
  ReservationsRead: 'reservations:read',
  ReservationsWrite: 'reservations:write',
} as const;

export type PartnerScope = (typeof PARTNER_SCOPES)[keyof typeof PARTNER_SCOPES];

export const PARTNER_SCOPES_KEY = 'partnerScopes';

/**
 * Declare the scope(s) a partner key must hold to call the decorated route.
 * Enforced by {@link PartnerApiKeyGuard}.
 */
export const RequireScopes = (...scopes: PartnerScope[]) =>
  SetMetadata(PARTNER_SCOPES_KEY, scopes);

/** Payload encoded inside the JWT access token. */
export interface JwtAccessPayload {
  /** Subject — the user id. */
  sub: string;
  /** Tenant id. */
  tid: string;
  /** Role code (OWNER / MANAGER / FRONT_DESK / etc.). */
  role: string;
  /** Granted permission codes (cached at login time). */
  perms: string[];
  /** Email — convenience for client side. */
  email: string;
}

/** Payload encoded inside the JWT refresh token. */
export interface JwtRefreshPayload {
  sub: string;
  tid: string;
  /** Random JTI used to look up the refresh token row in DB. */
  jti: string;
}

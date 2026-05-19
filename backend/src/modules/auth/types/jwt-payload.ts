/** Payload encoded inside the JWT access token. */
export interface JwtAccessPayload {
  /** Subject — the user id. */
  sub: string;
  /** Tenant id. */
  tid: string;
  /** Role code (OWNER / MANAGER / FRONT_DESK / etc. / SUPER_ADMIN). */
  role: string;
  /** Granted permission codes (cached at login time). */
  perms: string[];
  /** Email — convenience for client side. */
  email: string;
  /**
   * isSuperAdmin — present and true only for SUPER_ADMIN accounts.
   * TenantContextInterceptor skips RLS enforcement when this is true.
   */
  isa?: boolean;
  /**
   * Impersonated-by userId — set when a super-admin issues an impersonation
   * token for a specific tenant.
   */
  imp?: string;
}

/** Payload encoded inside the JWT refresh token. */
export interface JwtRefreshPayload {
  sub: string;
  tid: string;
  /** Random JTI used to look up the refresh token row in DB. */
  jti: string;
}

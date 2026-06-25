import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PartnerScope } from './decorators/partner-scopes.decorator';

/** Identity attached to the request after a successful key verification. */
export interface VerifiedPartner {
  id: string;
  name: string;
  scopes: string[];
}

/** Result of minting a new key — the plaintext is present ONLY here, once. */
export interface MintedKey {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  /** Full plaintext key. Show once, store nowhere — it cannot be recovered. */
  plaintext: string;
}

/**
 * Issues and verifies partner API keys for the connectivity API.
 *
 * Security model (TravelLine / Stripe style):
 *   - The plaintext key looks like `klh_live_<32 url-safe chars>`.
 *   - Only `sha256(plaintext)` is persisted (`keyHash`); the plaintext is
 *     returned exactly once at mint time and is irrecoverable thereafter.
 *   - `keyPrefix` (first {@link PREFIX_LEN} chars) is stored + indexed for O(1)
 *     lookup without exposing the secret.
 *   - Verification is constant-time (`timingSafeEqual`) to avoid timing oracles.
 *   - Inactive / revoked / expired keys never verify.
 */
@Injectable()
export class PartnerKeyService {
  private readonly logger = new Logger(PartnerKeyService.name);

  /** Key environment tag baked into the plaintext (purely cosmetic / ops). */
  private static readonly ENV_TAG = process.env.NODE_ENV === 'production' ? 'live' : 'test';
  /** Number of leading chars used as the indexed lookup handle. */
  private static readonly PREFIX_LEN = 16;

  constructor(private readonly prisma: PrismaService) {}

  private hash(key: string): string {
    return createHash('sha256').update(key, 'utf8').digest('hex');
  }

  /**
   * Create a new partner key. Returns the plaintext ONCE.
   * Uses the admin (BYPASSRLS) client — the table is invisible to app_user.
   */
  async mint(params: {
    name: string;
    scopes: PartnerScope[];
    expiresAt?: Date | null;
  }): Promise<MintedKey> {
    const secret = randomBytes(24).toString('base64url'); // 32 url-safe chars
    const plaintext = `klh_${PartnerKeyService.ENV_TAG}_${secret}`;
    const keyPrefix = plaintext.slice(0, PartnerKeyService.PREFIX_LEN);
    const keyHash = this.hash(plaintext);

    const row = await this.prisma.admin.partnerApiKey.create({
      data: {
        name: params.name,
        keyPrefix,
        keyHash,
        scopes: params.scopes,
        expiresAt: params.expiresAt ?? null,
      },
    });

    this.logger.log(`Partner key minted: ${row.name} (${keyPrefix}…) scopes=[${params.scopes.join(', ')}]`);
    return { id: row.id, name: row.name, keyPrefix, scopes: row.scopes, plaintext };
  }

  /**
   * Verify an incoming raw key. Returns the partner identity or null.
   * Never throws on bad input — callers translate null into 401.
   */
  async verify(rawKey: string | undefined | null): Promise<VerifiedPartner | null> {
    if (!rawKey || !rawKey.startsWith('klh_') || rawKey.length < PartnerKeyService.PREFIX_LEN) {
      return null;
    }

    const keyPrefix = rawKey.slice(0, PartnerKeyService.PREFIX_LEN);
    const row = await this.prisma.admin.partnerApiKey.findUnique({ where: { keyPrefix } });
    if (!row || !row.isActive || row.revokedAt) return null;
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;

    // Constant-time hash comparison.
    const expected = Buffer.from(row.keyHash, 'hex');
    const actual = Buffer.from(this.hash(rawKey), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return null;
    }

    // Best-effort last-used bump — never blocks or fails the request.
    this.prisma.admin.partnerApiKey
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch((e) => this.logger.warn(`lastUsedAt update failed: ${(e as Error).message}`));

    return { id: row.id, name: row.name, scopes: row.scopes };
  }

  /** List keys (metadata only — never exposes hashes). */
  async list() {
    const rows = await this.prisma.admin.partnerApiKey.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      keyPrefix: r.keyPrefix,
      scopes: r.scopes,
      isActive: r.isActive,
      lastUsedAt: r.lastUsedAt,
      expiresAt: r.expiresAt,
      revokedAt: r.revokedAt,
      createdAt: r.createdAt,
    }));
  }

  /** Soft-revoke a key by id. */
  async revoke(id: string): Promise<{ ok: true }> {
    await this.prisma.admin.partnerApiKey.update({
      where: { id },
      data: { isActive: false, revokedAt: new Date() },
    });
    this.logger.log(`Partner key revoked: ${id}`);
    return { ok: true };
  }
}

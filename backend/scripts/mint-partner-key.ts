/**
 * Mint a partner API key for the connectivity API.
 *
 *   pnpm ts-node scripts/mint-partner-key.ts "Kars Avia (dev)" \
 *     hotels:read availability:read reservations:read reservations:write
 *
 * The plaintext key is printed ONCE — copy it into the partner's config
 * (e.g. Avia's HOTEL_PMS_API_KEY). It is hashed at rest and irrecoverable.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PartnerKeyService } from '../src/modules/connectivity/partner-key.service';
import { PARTNER_SCOPES, PartnerScope } from '../src/modules/connectivity/decorators/partner-scopes.decorator';

const VALID = new Set<string>(Object.values(PARTNER_SCOPES));

async function main() {
  const [, , nameArg, ...scopeArgs] = process.argv;
  const name = nameArg?.trim();
  if (!name) {
    console.error('Usage: ts-node scripts/mint-partner-key.ts "<name>" [scope ...]');
    console.error(`Valid scopes: ${[...VALID].join(', ')}`);
    process.exit(1);
  }

  const scopes = (scopeArgs.length ? scopeArgs : [...VALID]) as PartnerScope[];
  const invalid = scopes.filter((s) => !VALID.has(s));
  if (invalid.length) {
    console.error(`Invalid scope(s): ${invalid.join(', ')}`);
    console.error(`Valid scopes: ${[...VALID].join(', ')}`);
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const keys = app.get(PartnerKeyService);
    const minted = await keys.mint({ name, scopes });

    console.log('\n  Partner API key created');
    console.log('  ─────────────────────────────────────────────');
    console.log(`  name    : ${minted.name}`);
    console.log(`  id      : ${minted.id}`);
    console.log(`  prefix  : ${minted.keyPrefix}`);
    console.log(`  scopes  : ${minted.scopes.join(', ')}`);
    console.log('\n  API KEY (shown once — store it now):\n');
    console.log(`    ${minted.plaintext}\n`);
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

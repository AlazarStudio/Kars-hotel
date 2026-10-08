import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CANCELLED_DAYS, CONTACTS_DAYS, RULES, retentionMode } from './retention.rules';

/* 152-ФЗ, Р-11, решение 21; план 13.9. Правила проверены живым прогоном на
 * одноразовой копии базы (см. коммит); здесь — то, что легко сломать правкой. */

describe('Сроки хранения PMS', () => {
  it('по умолчанию выключено; включается только явным dry/on', () => {
    expect(retentionMode({} as NodeJS.ProcessEnv)).toBe('off');
    expect(retentionMode({ PMS_RETENTION_MODE: 'yes' } as NodeJS.ProcessEnv)).toBe('off');
    expect(retentionMode({ PMS_RETENTION_MODE: ' DRY ' } as NodeJS.ProcessEnv)).toBe('dry');
    expect(retentionMode({ PMS_RETENTION_MODE: 'on' } as NodeJS.ProcessEnv)).toBe('on');
  });

  it('все правила решения 21 на месте', () => {
    expect(RULES.map((r) => r.id).sort()).toEqual(
      ['cancelled-noshow', 'dismissed-staff', 'folio-names', 'guest-contacts', 'orphan-journal', 'sessions'].sort(),
    );
    expect([CANCELLED_DAYS, CONTACTS_DAYS]).toEqual([30, 92]);
  });

  it('гостиница может только СОКРАТИТЬ срок — LEAST с системным, не GREATEST', () => {
    const src = readFileSync(join(__dirname, 'retention.rules.ts'), 'utf8');
    expect(src).toMatch(/LEAST\(\$\{CANCELLED_DAYS\}, COALESCE\(t\.retention_cancelled_days/);
    expect(src).toMatch(/LEAST\(\$\{CONTACTS_DAYS\}, COALESCE\(t\.retention_contacts_days/);
    expect(src).not.toMatch(/GREATEST/);
  });
});

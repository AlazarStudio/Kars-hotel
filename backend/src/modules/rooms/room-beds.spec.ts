import { readFileSync } from 'fs';
import { join } from 'path';
import { BedType } from '@prisma/client';
import { bedsForCreate, bedsForUpdate } from './room-beds';

/* Кровати номера числами (27.10.2026). Прежний вид переводится в числа в ДВУХ
 * местах: миграцией (номера, что уже есть) и в коде (клиент API, который ещё
 * шлёт bedType). Тест держит их одинаковыми — иначе один и тот же «TWIN» стал
 * бы разным номером в зависимости от того, когда его завели. */

const ALL: BedType[] = Object.values(BedType);

function migrationMapping(): Record<string, { singleBeds: number; doubleBeds: number; sofas: number }> {
  const sql = readFileSync(
    join(__dirname, '../../../prisma/migrations/20261027180000_room_bed_counts/migration.sql'),
    'utf8',
  );
  const column = (name: string) => {
    const body = sql.split(`"${name}" = CASE "bed_type"`)[1].split('END')[0];
    return Object.fromEntries([...body.matchAll(/WHEN '(\w+)' THEN (\d+)/g)].map((m) => [m[1], Number(m[2])]));
  };
  const single = column('single_beds');
  const double = column('double_beds');
  const sofa = column('sofas');
  return Object.fromEntries(
    ALL.map((t) => [t, { singleBeds: single[t] ?? 0, doubleBeds: double[t] ?? 0, sofas: sofa[t] ?? 0 }]),
  );
}

describe('Кровати номера: прежний вид → числа', () => {
  it.each(ALL)('%s — в коде так же, как в миграции', (t) => {
    const { extraBeds, ...beds } = bedsForCreate({ bedType: t });
    expect(beds).toEqual(migrationMapping()[t]);
    expect(extraBeds).toBe(0);
  });

  it('у каждого вида есть хоть одно спальное место — пустым перенесённый номер не останется', () => {
    for (const t of ALL) {
      const b = bedsForCreate({ bedType: t });
      expect(b.singleBeds + b.doubleBeds + b.sofas).toBeGreaterThan(0);
    }
  });
});

describe('Кровати нового номера', () => {
  it('ничего не прислали — одна двуспальная, как прежнее умолчание DOUBLE', () => {
    expect(bedsForCreate({})).toEqual({ singleBeds: 0, doubleBeds: 1, sofas: 0, extraBeds: 0 });
  });

  it('прислали числа — берутся они, неприсланные равны 0, вид НЕ подмешивается', () => {
    expect(bedsForCreate({ bedType: 'TWIN', doubleBeds: 1, sofas: 1 })).toEqual({
      singleBeds: 0,
      doubleBeds: 1,
      sofas: 1,
      extraBeds: 0,
    });
  });

  it('доп. кровати — свои и при числах, и при виде', () => {
    expect(bedsForCreate({ singleBeds: 2, extraBeds: 1 }).extraBeds).toBe(1);
    expect(bedsForCreate({ bedType: 'DOUBLE', extraBeds: 2 }).extraBeds).toBe(2);
  });
});

describe('Правка кроватей номера', () => {
  it('меняется только присланное — остальные числа НЕ обнуляются', () => {
    expect(bedsForUpdate({ sofas: 1 })).toEqual({
      singleBeds: undefined,
      doubleBeds: undefined,
      sofas: 1,
      extraBeds: undefined,
    });
  });

  it('прислали только вид — числа из него', () => {
    expect(bedsForUpdate({ bedType: 'TWO_DOUBLE' })).toEqual({
      singleBeds: 0,
      doubleBeds: 2,
      sofas: 0,
      extraBeds: undefined,
    });
  });

  it('ничего о кроватях — ничего и не меняет', () => {
    expect(bedsForUpdate({})).toEqual({ extraBeds: undefined });
  });
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient } from '@tanstack/react-query';
import { invalidateRatePlanQueries } from './ratePlanCache.js';

test('смена договора сбрасывает цены таблицы и календаря только изменённого тарифа', async () => {
  const qc = new QueryClient();
  const own = ['contract-prices', 'p1', '2026-11-14', '2026-11-14'];
  const calendar = ['contract-prices', 'p1', '2026-11-10', '2026-11-24'];
  const other = ['contract-prices', 'p2', null, null];
  for (const key of [['ratePlans'], own, calendar, other]) qc.setQueryData(key, { old: true });
  await invalidateRatePlanQueries(qc, 'p1');
  assert.equal(qc.getQueryState(['ratePlans']).isInvalidated, true);
  assert.equal(qc.getQueryState(own).isInvalidated, true);
  assert.equal(qc.getQueryState(calendar).isInvalidated, true);
  assert.equal(qc.getQueryState(other).isInvalidated, false);
  qc.clear();
});

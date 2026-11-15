import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveWizardSteps } from './tariffWizard.js';

test('завершение мастера сначала сохраняет цены и сезоны, затем условия', async () => {
  const calls = [];
  const result = await saveWizardSteps([
    { step: 2, save: async () => { calls.push('prices'); return true; } },
    { step: 3, save: async () => { calls.push('seasons'); return true; } },
  ], async () => { calls.push('plan'); return { id: 'p1' }; });
  assert.deepEqual(calls, ['prices', 'seasons', 'plan']);
  assert.equal(result.saved, true);
});

test('ошибка цен оставляет мастер на шаге цен и не сохраняет следующие шаги', async () => {
  let continued = false;
  const result = await saveWizardSteps([
    { step: 2, save: async () => false },
    { step: 3, save: async () => { continued = true; return true; } },
  ], async () => { continued = true; return true; });
  assert.deepEqual(result, { saved: false, step: 2 });
  assert.equal(continued, false);
});

test('ошибка полей тарифа не разрешает закрыть окно', async () => {
  assert.deepEqual(await saveWizardSteps([], async () => undefined), { saved: false, step: 0 });
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

const require = createRequire(import.meta.url);
const { QueryClient, QueryClientProvider } = require('@tanstack/react-query');
const { build } = createRequire(import.meta.resolve('vite'))('esbuild');
const bundle = await build({
  stdin: {
    contents: `
      import { useContracts } from './useContracts.js';
      import { usePartners } from './usePartners.js';
      export { sliceOptions } from '../../Components/HotelPMS/components/Tariffs/corporateTariff.js';
      export function Probe() {
        const partners = usePartners();
        const contracts = useContracts();
        globalThis.fixture.view = { partners: partners.data, contracts: contracts.data };
        return null;
      }
    `,
    resolveDir: fileURLToPath(new URL('.', import.meta.url)),
  },
  bundle: true, platform: 'node', format: 'cjs', write: false,
  external: ['react', '@tanstack/react-query'],
  plugins: [{ name: 'api-io', setup(builder) {
    builder.onResolve({ filter: /^\.\.\/\.\.\/api\/(partners|contracts)$/ }, ({ path }) => ({ path, namespace: 'io' }));
    builder.onLoad({ filter: /.*/, namespace: 'io' }, ({ path }) => ({ contents: path.endsWith('/partners')
      ? 'export const listPartners = () => globalThis.fixture.read("partners");'
      : `export const listContracts = () => globalThis.fixture.read('contracts');
         export const fetchContractPrices = async () => {};
         export const previewContractPrices = async () => {};`,
    }));
  } }],
});

const newContract = { partnerId: 'p1', number: 'NEW', account: { code: 'new-account' },
  slices: [{ customer: 'new-customer', guestKind: null, mealPlan: 'BB' }] };
const stalePartner = { id: 'p1', accounts: [], customers: [] };
const updatedPartner = { id: 'p1', accounts: [{ id: 'account-id', code: 'new-account' }],
  customers: [{ id: 'customer-id', code: 'new-customer' }] };

async function withHooks(initialContracts, scenario) {
  const fixture = {
    calls: { contracts: 0, partners: 0 },
    source: { contracts: initialContracts, partners: [stalePartner] },
    failContracts: false,
    async read(key) {
      this.calls[key]++;
      if (key === 'contracts' && this.failContracts) throw new Error('offline');
      return structuredClone(this.source[key]);
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require, fixture });
  const { Probe, sliceOptions } = module.exports;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, gcTime: 0 } } });
  const flush = async () => {
    // Query observers notify React on a scheduled task; their effects may
    // schedule the directory read and its observer notification in turn.
    for (let i = 0; i < 3; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  };
  const refetchContracts = async () => {
    await act(async () => { await client.refetchQueries({ queryKey: ['contracts'] }); });
    await flush();
  };
  let renderer;
  try {
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(QueryClientProvider, { client }, React.createElement(Probe)));
    });
    await flush();
    assert.equal(fixture.calls.contracts, 1);
    assert.ok(fixture.view.partners);
    const options = () => sliceOptions(fixture.view.contracts[0], fixture.view.partners[0]);
    await scenario({ fixture, refetchContracts, options });
  } finally {
    await act(async () => renderer?.unmount());
    client.clear();
  }
}

test('a contracts refresh also loads the account and airline needed by the new contract', async () => {
  await withHooks([], async ({ fixture, refetchContracts, options }) => {
    const readsBefore = fixture.calls.partners;
    fixture.source.contracts = [newContract];
    fixture.source.partners = [updatedPartner];
    await refetchContracts();
    assert.equal(fixture.view.contracts[0].number, 'NEW');
    assert.ok(fixture.calls.partners > readsBefore);
    assert.equal(options().accounts[0].id, 'account-id');
    assert.equal(options().customers[0].id, 'customer-id');
  });
});

test('an unchanged contracts response refreshes the directory after a failed cycle', async () => {
  await withHooks([newContract], async ({ fixture, refetchContracts, options }) => {
    assert.equal(options().unresolvedAccount, true);
    assert.equal(options().unresolvedCustomer, true);
    const readsBefore = fixture.calls.partners;
    const contracts = fixture.view.contracts;
    const partners = fixture.view.partners;
    fixture.source.partners = [updatedPartner];
    fixture.failContracts = true;
    await refetchContracts();
    assert.equal(fixture.view.contracts, contracts);
    assert.equal(fixture.view.partners, partners);
    assert.equal(fixture.calls.partners, readsBefore);
    fixture.failContracts = false;
    await refetchContracts();
    assert.equal(fixture.view.contracts, contracts); // TanStack Query kept the data reference.
    assert.ok(fixture.calls.partners > readsBefore);
    assert.equal(options().unresolvedAccount, false);
    assert.equal(options().unresolvedCustomer, false);
  });
});

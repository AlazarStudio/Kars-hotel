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
  entryPoints: [fileURLToPath(new URL('./useRatePlans.js', import.meta.url))],
  bundle: true, platform: 'node', format: 'cjs', write: false,
  external: ['react', '@tanstack/react-query'],
  plugins: [{ name: 'http-boundary', setup(builder) {
    builder.onResolve({ filter: /\/client$/ }, (args) => ({ path: args.path, namespace: 'http' }));
    builder.onLoad({ filter: /.*/, namespace: 'http' }, () => ({ contents: 'export const api = globalThis.http;' }));
  } }],
});

test('категории тарифов используют rate endpoint и отдельный кэш, инвалидируемый правкой категории', async () => {
  const requests = [];
  const roomTypes = [{ id: 'r1', name: 'Стандарт', maxOccupancy: 2, basePrice: '3000.00' }];
  const http = { get: async (path) => {
    requests.push(path);
    if (path !== '/rate-plans/room-types') throw Error('403 room.read required');
    return { data: roomTypes };
  } };
  const module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require, http });
  assert.equal(typeof module.exports.useTariffRoomTypes, 'function');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  qc.setQueryData(['roomTypes'], [{ id: 'private', photos: ['private'] }]);
  let result;
  function Probe() { result = module.exports.useTariffRoomTypes(); return null; }
  let renderer;
  try {
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(QueryClientProvider, { client: qc }, React.createElement(Probe)));
    });
    for (let attempt = 0; result.isPending && attempt < 20; attempt += 1) {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    }
    assert.equal(result.isError, false);
    assert.deepEqual(result.data, roomTypes);
    assert.deepEqual(requests, ['/rate-plans/room-types']);
    assert.deepEqual(qc.getQueryData(['roomTypes']), [{ id: 'private', photos: ['private'] }]);
    await act(async () => { await qc.invalidateQueries({ queryKey: ['roomTypes'] }); });
    assert.deepEqual(requests, ['/rate-plans/room-types', '/rate-plans/room-types']);
  } finally {
    await act(async () => renderer?.unmount());
    qc.clear();
  }
});

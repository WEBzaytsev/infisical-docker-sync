import assert from 'node:assert/strict';
import { test } from 'node:test';

import { recreateContainer } from '../src/docker-manager.js';

test('recreateContainer sends the per-service pullImage flag to recreate-proxy', async () => {
  const originalFetch = globalThis.fetch;
  let payload: unknown;

  globalThis.fetch = (async (_input, init) => {
    payload = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ ok: true, code: 'ok' }), { status: 200 });
  }) as typeof fetch;

  try {
    await recreateContainer('app', { FEATURE: 'enabled' }, ['REMOVED'], true);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(payload, {
    container: 'app',
    env: { FEATURE: 'enabled' },
    removed: ['REMOVED'],
    pullImage: true,
  });
});

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { StateManager } from '../src/state-manager.js';

test('StateManager persists a pending recreate and its removed keys across reload', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ids-state-'));
  const statePath = path.join(dir, 'agent-state.json');

  try {
    const state = new StateManager(statePath);
    await state.loadState();
    await state.updateServiceState('app', '/tmp/app.env', 'hash', 1, ['REMOVED', 'LEGACY']);

    assert.deepEqual(state.getPendingRecreate('app'), { removedKeys: ['REMOVED', 'LEGACY'] });

    const reloaded = new StateManager(statePath);
    await reloaded.loadState();
    assert.deepEqual(reloaded.getPendingRecreate('app'), { removedKeys: ['REMOVED', 'LEGACY'] });

    await reloaded.clearPendingRecreate('app');
    assert.equal(reloaded.getPendingRecreate('app'), undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

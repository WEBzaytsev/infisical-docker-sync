import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { syncService } from '../src/index.js';
import { StateManager } from '../src/state-manager.js';
import type { Config, ServiceConfig } from '../src/types.js';

const config: Config = {
  siteUrl: 'https://app.infisical.com',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  syncInterval: 60,
  logLevel: 'silent',
  services: [],
};

test('syncService retries a failed recreate on the next cycle without reverting the updated env file', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ids-sync-'));
  const envPath = path.join(dir, '.env');
  const state = new StateManager(path.join(dir, 'agent-state.json'));
  const service: ServiceConfig = {
    container: 'app',
    envDir: dir,
    envFileName: '.env',
    projectId: 'project-id',
    environment: 'prod',
  };
  const recreateCalls: Array<{ removedKeys: string[] }> = [];
  let attempts = 0;

  await writeFile(envPath, 'KEEP=old\nREMOVED=obsolete\n');
  await state.loadState();

  try {
    const dependencies = {
      fetchEnv: async () => ({ KEEP: 'new' }),
      recreateContainer: async (_container: string, _env: Record<string, string>, removedKeys: string[] = []) => {
        recreateCalls.push({ removedKeys });
        attempts += 1;
        if (attempts === 1) throw new Error('registry unavailable');
      },
      state,
    };

    await syncService(service, config, dependencies);
    assert.equal(await readFile(envPath, 'utf8'), 'KEEP=new');
    assert.deepEqual(state.getPendingRecreate('app'), { removedKeys: ['REMOVED'] });

    const reloadedState = new StateManager(path.join(dir, 'agent-state.json'));
    await reloadedState.loadState();
    await syncService(service, config, { ...dependencies, state: reloadedState });
    assert.deepEqual(recreateCalls, [
      { removedKeys: ['REMOVED'] },
      { removedKeys: ['REMOVED'] },
    ]);
    assert.equal(reloadedState.getPendingRecreate('app'), undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('syncService serializes overlapping syncs for the same container', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ids-sync-'));
  const state = new StateManager(path.join(dir, 'agent-state.json'));
  const service: ServiceConfig = {
    container: 'app',
    envDir: dir,
    envFileName: '.env',
    projectId: 'project-id',
    environment: 'prod',
  };
  let releaseRecreate!: () => void;
  const recreateFinished = new Promise<void>(resolve => { releaseRecreate = resolve; });
  let signalFirstRecreate!: () => void;
  const firstRecreateStarted = new Promise<void>(resolve => { signalFirstRecreate = resolve; });
  let recreateCalls = 0;

  await state.loadState();
  try {
    const dependencies = {
      fetchEnv: async () => ({ KEEP: 'new' }),
      recreateContainer: async () => {
        recreateCalls += 1;
        if (recreateCalls === 1) signalFirstRecreate();
        await recreateFinished;
      },
      state,
    };

    const first = syncService(service, config, dependencies);
    await firstRecreateStarted;
    const second = syncService(service, config, dependencies);
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(recreateCalls, 1);

    releaseRecreate();
    await Promise.all([first, second]);
  } finally {
    releaseRecreate();
    await rm(dir, { recursive: true, force: true });
  }
});

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { syncService } from '../src/index.js';
import { InfisicalSecretConflictError } from '../src/infisical-client.js';
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
    secretPath: '/',
    secretScope: 'folder',
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

test('syncService rewrites a non-canonical dotenv file when values are unchanged', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ids-format-'));
  const envPath = path.join(dir, '.env');
  const state = new StateManager(path.join(dir, 'agent-state.json'));
  const service: ServiceConfig = {
    container: 'app',
    envDir: dir,
    envFileName: '.env',
    projectId: 'project-id',
    environment: 'prod',
    secretPath: '/',
    secretScope: 'folder',
  };
  let recreateCalls = 0;

  await writeFile(envPath, 'PASSWORD="value$HOME"');
  await state.loadState();

  try {
    await syncService(service, config, {
      fetchEnv: async () => ({ PASSWORD: 'value$HOME' }),
      recreateContainer: async () => {
        recreateCalls += 1;
      },
      state,
    });

    assert.equal(await readFile(envPath, 'utf8'), "PASSWORD='value$HOME'");
    assert.equal(recreateCalls, 1);
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
    secretPath: '/',
    secretScope: 'folder',
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
  }
});

test('syncService recreates replicas sequentially and retries only the failed replica', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ids-replicas-'));
  const state = new StateManager(path.join(dir, 'agent-state.json'));
  const service: ServiceConfig = {
    container: 'back-prod-api-a',
    replicas: ['back-prod-api-b'],
    envDir: dir,
    envFileName: '.env',
    projectId: 'project-id',
    environment: 'prod',
    secretPath: '/',
    secretScope: 'folder',
  };
  const recreated: string[] = [];
  let failReplicaB = true;

  await state.loadState();
  try {
    const dependencies = {
      fetchEnv: async () => ({ KEEP: 'new' }),
      recreateContainer: async (container: string) => {
        recreated.push(container);
        if (container === 'back-prod-api-b' && failReplicaB) throw new Error('replica b unavailable');
      },
      state,
    };

    await syncService(service, config, dependencies);
    assert.deepEqual(recreated, ['back-prod-api-a', 'back-prod-api-b']);
    assert.deepEqual(state.getPendingRecreate('back-prod-api-a'), {
      removedKeys: [],
      containers: ['back-prod-api-b'],
    });

    failReplicaB = false;
    await syncService(service, config, dependencies);
    assert.deepEqual(recreated, ['back-prod-api-a', 'back-prod-api-b', 'back-prod-api-b']);
    assert.equal(state.getPendingRecreate('back-prod-api-a'), undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('syncService requests secrets from the configured Infisical folder', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ids-folder-'));
  const state = new StateManager(path.join(dir, 'agent-state.json'));
  const service: ServiceConfig = {
    container: 'folder-app',
    envDir: dir,
    envFileName: '.env',
    projectId: 'project-id',
    environment: 'prod',
    secretPath: '/applications/folder-app',
    secretScope: 'folder',
  };
  let receivedPath: string | undefined;

  await state.loadState();
  try {
    await syncService(service, config, {
      fetchEnv: async credentials => {
        receivedPath = credentials.secretPath;
        return { KEEP: 'new' };
      },
      recreateContainer: async () => undefined,
      state,
    });

    assert.equal(receivedPath, '/applications/folder-app');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('syncService leaves .env and recreate state untouched when Infisical keys conflict', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ids-conflict-'));
  const envPath = path.join(dir, '.env');
  const state = new StateManager(path.join(dir, 'agent-state.json'));
  const service: ServiceConfig = {
    container: 'app',
    envDir: dir,
    envFileName: '.env',
    projectId: 'project-id',
    environment: 'prod',
    secretPath: '/',
    secretScope: 'folder',
  };
  let recreateCalls = 0;

  await writeFile(envPath, 'MIGRATIONS_IMAGE_TAG=immutable-sha\n');
  await state.loadState();

  try {
    await syncService(service, config, {
      fetchEnv: async () => {
        throw new InfisicalSecretConflictError('MIGRATIONS_IMAGE_TAG', ['/', '/worker']);
      },
      recreateContainer: async () => {
        recreateCalls += 1;
      },
      state,
    });

    assert.equal(await readFile(envPath, 'utf8'), 'MIGRATIONS_IMAGE_TAG=immutable-sha\n');
    assert.equal(recreateCalls, 0);
    assert.equal(state.getPendingRecreate('app'), undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

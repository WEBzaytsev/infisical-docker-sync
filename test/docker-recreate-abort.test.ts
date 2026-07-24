import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  recreateContainer,
  setDockerClientForTests,
} from '../src/proxy/docker-recreate.js';

const MANAGED_LABEL = 'infisical-docker-sync.enabled';

test('recreateContainer does not stop or remove the target when cancellation arrives during image pull', async () => {
  let releasePull!: () => void;
  const pullFinished = new Promise<void>(resolve => { releasePull = resolve; });
  let markPullStarted!: () => void;
  const pullStarted = new Promise<void>(resolve => { markPullStarted = resolve; });
  let stopCalls = 0;
  let removeCalls = 0;

  const target = {
    Id: 'target-id',
    Image: 'ghcr.io/example/app:latest',
    Labels: { [MANAGED_LABEL]: 'true' },
    Names: ['/app'],
    State: 'running',
  };
  const client = {
    listContainers: async () => [target],
    getContainer: () => ({
      inspect: async () => ({ Config: { Image: target.Image, Env: [] } }),
      stop: async () => { stopCalls += 1; },
      remove: async () => { removeCalls += 1; },
    }),
    pull: (_image: string, _options: object, callback: (error: Error | null, stream?: NodeJS.ReadableStream) => void) => {
      markPullStarted();
      callback(null, {} as NodeJS.ReadableStream);
    },
    modem: {
      followProgress: async (_stream: NodeJS.ReadableStream, callback: (error: Error | null) => void) => {
        await pullFinished;
        callback(null);
      },
    },
  };
  const controller = new AbortController();

  setDockerClientForTests(client);
  try {
    const recreation = recreateContainer('app', undefined, [], true, controller.signal);
    await pullStarted;
    controller.abort();
    releasePull();

    await assert.rejects(recreation, { name: 'AbortError' });
    assert.equal(stopCalls, 0);
    assert.equal(removeCalls, 0);
  } finally {
    setDockerClientForTests();
  }
});

test('recreateContainer restarts an already-stopped dependent after cancellation', async () => {
  const controller = new AbortController();
  let targetStopCalls = 0;
  let targetRemoveCalls = 0;
  let dependentStopCalls = 0;
  let dependentStartCalls = 0;
  const target = {
    Id: 'target-id',
    Image: 'ghcr.io/example/app:latest',
    Labels: {
      [MANAGED_LABEL]: 'true',
      'com.docker.compose.project': 'project',
      'com.docker.compose.service': 'app',
    },
    Names: ['/app'],
    State: 'running',
  };
  const dependent = {
    Id: 'dependent-id',
    Image: 'ghcr.io/example/worker:latest',
    Labels: {
      'com.docker.compose.project': 'project',
      'com.docker.compose.service': 'worker',
      'com.docker.compose.depends_on': '["app"]',
    },
    Names: ['/worker'],
    State: 'running',
  };
  const client = {
    listContainers: async (options?: { filters?: { name?: string[] } }) =>
      options?.filters?.name?.includes('worker') ? [dependent] : [target, dependent],
    getContainer: (id: string) => id === dependent.Id
      ? {
          stop: async () => {
            dependentStopCalls += 1;
            controller.abort();
          },
          start: async () => { dependentStartCalls += 1; },
        }
      : {
          inspect: async () => ({ Config: { Image: target.Image, Env: [] } }),
          stop: async () => { targetStopCalls += 1; },
          remove: async () => { targetRemoveCalls += 1; },
        },
  };

  setDockerClientForTests(client);
  try {
    await assert.rejects(
      recreateContainer('app', undefined, [], false, controller.signal),
      { name: 'AbortError' },
    );
    assert.equal(dependentStopCalls, 1);
    assert.equal(dependentStartCalls, 1);
    assert.equal(targetStopCalls, 0);
    assert.equal(targetRemoveCalls, 0);
  } finally {
    setDockerClientForTests();
  }
});

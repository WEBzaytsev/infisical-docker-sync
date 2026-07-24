import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  pullImageBeforeRecreate,
  type DockerPullClient,
} from '../src/proxy/docker-recreate.js';

interface PullCall {
  image: string;
  auth?: {
    serveraddress: string;
    username?: string;
    password?: string;
    identitytoken?: string;
  };
}

function createPullClient(): { client: DockerPullClient; calls: PullCall[] } {
  const calls: PullCall[] = [];
  const client: DockerPullClient = {
    pull(image, _options, callback, auth) {
      calls.push({ image, auth });
      queueMicrotask(() => callback(null, {} as NodeJS.ReadableStream));
    },
    modem: {
      followProgress(_stream, callback) {
        queueMicrotask(() => callback(null, []));
      },
    },
  };

  return { client, calls };
}

test('pullImageBeforeRecreate pulls a fresh image when the service flag is enabled', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ids-docker-auth-'));
  const authConfigFile = path.join(tempDir, 'config.json');
  await writeFile(authConfigFile, JSON.stringify({
    auths: {
      'ghcr.io': {
        auth: Buffer.from('registry-user:registry-password').toString('base64'),
      },
    },
  }));

  const { client, calls } = createPullClient();
  try {
    await pullImageBeforeRecreate(
      'ghcr.io/webzaytsev/private-image:latest',
      true,
      authConfigFile,
      client,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }

  assert.deepEqual(calls, [{
    image: 'ghcr.io/webzaytsev/private-image:latest',
    auth: {
      username: 'registry-user',
      password: 'registry-password',
      serveraddress: 'ghcr.io',
    },
  }]);
});

test('pullImageBeforeRecreate does not pull when disabled', async () => {
  const { client, calls } = createPullClient();

  await pullImageBeforeRecreate('ghcr.io/webzaytsev/private-image:latest', false, undefined, client);

  assert.deepEqual(calls, []);
});

test('pullImageBeforeRecreate fails before requesting Docker when an explicit auth config is unavailable', async () => {
  const { client, calls } = createPullClient();

  await assert.rejects(
    pullImageBeforeRecreate(
      'ghcr.io/webzaytsev/private-image:latest',
      true,
      '/definitely-missing/docker-config.json',
      client,
    ),
    /DOCKER_AUTH_CONFIG_FILE/,
  );

  assert.deepEqual(calls, []);
});

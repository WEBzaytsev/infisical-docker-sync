import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { loadConfig } from '../src/config-loader.js';
import { writeEnvFileSafely } from '../src/env-watcher.js';
import { validateProxyUrl } from '../src/docker-manager.js';
import { validateProxyToken } from '../src/proxy/security.js';

test('loadConfig rejects public http Infisical URLs', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ids-config-'));
  const configPath = path.join(dir, 'config.yaml');

  await writeFile(configPath, `
siteUrl: http://app.infisical.com
clientId: client-id
clientSecret: client-secret
services:
  - container: app
    envFileName: .env
    envDir: ${dir}
    projectId: project-id
    environment: prod
`);

  await assert.rejects(
    () => loadConfig(configPath),
    /http разрешён только для локального Infisical/i
  );

  await rm(dir, { recursive: true, force: true });
});

test('loadConfig allows local http Infisical URLs', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ids-config-'));
  const configPath = path.join(dir, 'config.yaml');

  await writeFile(configPath, `
siteUrl: http://localhost:8080
clientId: client-id
clientSecret: client-secret
services:
  - container: app
    envFileName: .env
    envDir: ${dir}
    projectId: project-id
    environment: prod
`);

  const config = await loadConfig(configPath);
  assert.equal(config.siteUrl, 'http://localhost:8080');

  await rm(dir, { recursive: true, force: true });
});

test('validateProxyToken rejects weak values', () => {
  assert.throws(() => validateProxyToken('test'), /минимум 32 символа/i);
  assert.throws(() => validateProxyToken('a'.repeat(32)), /слабое значение/i);
  assert.doesNotThrow(() => validateProxyToken('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'));
});

test('validateProxyUrl only allows local or configured internal hosts', () => {
  assert.equal(validateProxyUrl('http://recreate-proxy:8080'), 'http://recreate-proxy:8080');
  assert.equal(validateProxyUrl('http://proxy.internal:8080', ['proxy.internal']), 'http://proxy.internal:8080');
  assert.throws(() => validateProxyUrl('https://evil.example/recreate'), /не входит в список разрешённых/i);
});

test('writeEnvFileSafely refuses to follow symlink target', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ids-env-'));
  const target = path.join(dir, 'target');
  const envPath = path.join(dir, '.env');

  await writeFile(target, 'ORIGINAL=1');
  await symlink(target, envPath);

  await assert.rejects(
    () => writeEnvFileSafely('app', envPath, 'SECRET=changed'),
    /символическая ссылка/i
  );

  assert.equal(await readFile(target, 'utf8'), 'ORIGINAL=1');

  await rm(dir, { recursive: true, force: true });
});

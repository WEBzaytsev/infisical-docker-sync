import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { formatConfigFile, loadConfig } from '../src/config-loader.js';

test('formatConfigFile applies the canonical YAML indentation and keeps comments', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ids-yaml-'));
  const file = path.join(dir, 'config.yaml');
  await writeFile(file, 'services:\n- container: app\n  projectId: project\n# keep this note\n');

  try {
    const changed = await formatConfigFile(file);
    const formatted = await readFile(file, 'utf8');
    assert.equal(changed, true);
    assert.match(formatted, /services:\n  - container: app/);
    assert.match(formatted, /# keep this note/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loadConfig accepts a scalar replicas value for a single replica', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ids-yaml-'));
  const file = path.join(dir, 'config.yaml');
  await writeFile(file, `siteUrl: https://infisical.example.com
clientId: client-id
clientSecret: client-secret
services:
  - container: back-prod-api-a
    envFileName: .env
    envDir: /back-prod
    projectId: project-id
    environment: prod
    replicas: back-prod-api-b
`);

  try {
    const config = await loadConfig(file);
    assert.deepEqual(config.services[0].replicas, ['back-prod-api-b']);
    assert.equal(config.services[0].secretPath, '/');
    assert.equal(config.services[0].secretScope, 'folder');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loadConfig accepts explicit subtree secret scope', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ids-yaml-'));
  const file = path.join(dir, 'config.yaml');
  await writeFile(file, `siteUrl: https://infisical.example.com
clientId: client-id
clientSecret: client-secret
services:
  - container: app
    envFileName: .env
    envDir: /app
    projectId: project-id
    environment: prod
    secretPath: /applications/app
    secretScope: subtree
`);

  try {
    const config = await loadConfig(file);
    assert.equal(config.services[0].secretPath, '/applications/app');
    assert.equal(config.services[0].secretScope, 'subtree');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('formatConfigFile separates service blocks with a blank line and is idempotent', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ids-yaml-'));
  const file = path.join(dir, 'config.yaml');
  await writeFile(file, 'services:\n- container: app\n- container: worker\n');

  try {
    await formatConfigFile(file);
    const formatted = await readFile(file, 'utf8');
    assert.match(formatted, /container: app\n\n  - container: worker/);
    assert.equal(await formatConfigFile(file), false);
    assert.equal(await readFile(file, 'utf8'), formatted);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  collectSecrets,
  InfisicalResponseError,
  InfisicalSecretConflictError,
} from '../src/infisical-client.js';

test('collectSecrets preserves distinct keys from the selected folder', () => {
  const env = collectSecrets({
    secrets: [
      { secretKey: 'API_URL', secretValue: 'https://api.example.com', secretPath: '/' },
      { secretKey: 'WORKER_MODE', secretValue: 'worker', secretPath: '/' },
    ],
  }, '/');

  assert.deepEqual(env, {
    API_URL: 'https://api.example.com',
    WORKER_MODE: 'worker',
  });
});

test('collectSecrets rejects malformed Infisical responses', () => {
  assert.throws(
    () => collectSecrets({ secrets: [{ secretKey: 'API_URL' }] }, '/'),
    (error: unknown) => {
      assert(error instanceof InfisicalResponseError);
      assert.equal(error.code, 'INFISICAL_INVALID_RESPONSE');
      return true;
    },
  );
});

test('collectSecrets rejects duplicate keys instead of using response order', () => {
  assert.throws(
    () => collectSecrets({
      secrets: [
        { secretKey: 'MIGRATIONS_IMAGE_TAG', secretValue: 'immutable-sha', secretPath: '/' },
        { secretKey: 'MIGRATIONS_IMAGE_TAG', secretValue: 'latest', secretPath: '/worker' },
      ],
    }, '/'),
    (error: unknown) => {
      assert(error instanceof InfisicalSecretConflictError);
      assert.equal(error.code, 'INFISICAL_SECRET_KEY_CONFLICT');
      assert.equal(error.secretKey, 'MIGRATIONS_IMAGE_TAG');
      assert.deepEqual(error.secretPaths, ['/', '/worker']);
      return true;
    },
  );
});

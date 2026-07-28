import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatStartupMessage } from '../src/build-info.js';

test('formatStartupMessage renders the application version and commit SHA', () => {
  assert.equal(
    formatStartupMessage('Infisical Docker Sync', {
      version: '1.0.0',
      commitSha: 'abc1234',
    }),
    'Infisical Docker Sync v1.0.0 (commit abc1234)',
  );
});

test('formatStartupMessage keeps unknown commit metadata explicit', () => {
  assert.equal(
    formatStartupMessage('recreate-proxy', {
      version: '1.0.0',
      commitSha: 'unknown',
    }),
    'recreate-proxy v1.0.0 (commit unknown)',
  );
});

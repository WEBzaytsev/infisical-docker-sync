import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatLogMessage } from '../src/logger.js';

test('formatLogMessage renders component and target once without JSON suffixes', () => {
  assert.equal(
    formatLogMessage({ component: 'sync', target: 'prod-dashboard' }, 'секреты актуальны'),
    '[sync] prod-dashboard: секреты актуальны',
  );
});

test('formatLogMessage does not add empty separators for global events', () => {
  assert.equal(formatLogMessage({ component: 'config' }, 'запуск агента'), '[config] запуск агента');
});

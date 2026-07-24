import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

test('pretty logs terminate every event with a newline', () => {
  const script = `
    import { info, error } from './src/logger.ts';
    info('first', { component: 'sync', target: 'demo' });
    error('second', { component: 'sync', target: 'demo' });
    await new Promise(resolve => setTimeout(resolve, 100));
  `;
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', script], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim().split('\n').length, 2, result.stdout);
});

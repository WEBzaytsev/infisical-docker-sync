import assert from 'node:assert/strict';
import { test } from 'node:test';

import { envToDotenvFormat, parseDotenvContent } from '../src/env-format.js';

test('writes values literally for Compose env_file format raw', () => {
  const env = {
    PASSWORD: 'value$HOME',
    TEMPLATE: 'value${VAR}',
    QUOTED: "it's a value",
    SURROUNDED_QUOTES: '"literal"',
    HASH: 'value # not a comment',
    BACKSLASH: String.raw`path\to\file`,
  };

  const formatted = envToDotenvFormat(env);

  assert.match(formatted, /^PASSWORD=value\$HOME$/m);
  assert.match(formatted, /^TEMPLATE=value\$\{VAR\}$/m);
  assert.match(formatted, /^QUOTED=it's a value$/m);
  assert.match(formatted, /^HASH=value # not a comment$/m);
  assert.ok(formatted.includes(`BACKSLASH=${String.raw`path\to\file`}`));
  assert.deepEqual(parseDotenvContent(formatted), env);
});

test('rejects multiline values instead of corrupting a raw env file', () => {
  assert.throws(
    () => envToDotenvFormat({ PRIVATE_KEY: 'line 1\nline 2' }),
    /PRIVATE_KEY.*multiline/
  );
});

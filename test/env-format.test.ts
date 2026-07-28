import assert from 'node:assert/strict';
import { test } from 'node:test';

import { envToDotenvFormat, parseDotenvContent } from '../src/env-format.js';

test('serializes Compose interpolation markers as literal single-quoted values', () => {
  const env = {
    PASSWORD: 'value$HOME',
    TEMPLATE: 'value${VAR}',
    QUOTED: "it's a value",
    BACKSLASH: String.raw`path\to\file`,
    MIXED: String.raw`it's $HOME and \${VAR}`,
  };

  const formatted = envToDotenvFormat(env);

  assert.match(formatted, /^PASSWORD='value\$HOME'$/m);
  assert.match(formatted, /^TEMPLATE='value\${VAR}'$/m);
  assert.match(formatted, /^QUOTED='it\\'s a value'$/m);
  assert.match(formatted, /^BACKSLASH='path\\to\\file'$/m);
  assert.deepEqual(parseDotenvContent(formatted), env);
});

test('parses Compose single-quoted literals without interpreting dollar signs or backslashes', () => {
  const content = [
    "PASSWORD='value$HOME'",
    "TEMPLATE='value${VAR}'",
    "QUOTED='it\\'s a value'",
    String.raw`BACKSLASH='path\to\file'`,
  ].join('\n');

  assert.deepEqual(parseDotenvContent(content), {
    PASSWORD: 'value$HOME',
    TEMPLATE: 'value${VAR}',
    QUOTED: "it's a value",
    BACKSLASH: String.raw`path\to\file`,
  });
});

test('parses existing double-quoted dotenv escapes for backward compatibility', () => {
  assert.deepEqual(parseDotenvContent('QUOTE="a\\\"b"\nSLASH="path\\\\file"'), {
    QUOTE: 'a"b',
    SLASH: String.raw`path\file`,
  });
});

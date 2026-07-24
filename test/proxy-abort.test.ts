import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';

import { createProxyServer } from '../src/proxy/server.js';

const TOKEN = [
  '0123456789abcdef0123456789abcdef',
  '0123456789abcdef0123456789abcdef',
].join('');

function listen(server: http.Server): Promise<void> {
  return new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('условие не выполнилось вовремя');
}

test('proxy aborts recreation after the client disconnects during image pull', async () => {
  let handlerStarted!: () => void;
  const started = new Promise<void>(resolve => { handlerStarted = resolve; });
  let releasePull!: () => void;
  const pullFinished = new Promise<void>(resolve => { releasePull = resolve; });
  let handlerFinished!: () => void;
  const finished = new Promise<void>(resolve => { handlerFinished = resolve; });
  let handlerSignal: AbortSignal | undefined;
  let destructiveOperations = 0;

  const server = createProxyServer({
    token: TOKEN,
    recreate: async (_container, _env, _removed, _pullImage, signal) => {
      handlerSignal = signal;
      handlerStarted();
      try {
        await pullFinished;
        if (!signal) throw new Error('proxy не передал AbortSignal');
        signal.throwIfAborted();
        destructiveOperations += 1;
      } finally {
        handlerFinished();
      }
    },
  });

  let request: http.ClientRequest | undefined;
  try {
    await listen(server);
    const address = server.address();
    assert(address && typeof address === 'object');

    request = http.request({
      host: '127.0.0.1',
      port: address.port,
      method: 'POST',
      path: '/recreate',
      headers: {
        'content-type': 'application/json',
        'x-proxy-token': TOKEN,
      },
    });
    request.on('error', () => undefined);
    request.end(JSON.stringify({ container: 'app', pullImage: true }));

    await started;
    request.destroy();
    await waitFor(() => handlerSignal?.aborted === true);

    releasePull();
    await finished;
    assert.equal(destructiveOperations, 0);
  } finally {
    request?.destroy();
    releasePull();
    await close(server);
  }
});

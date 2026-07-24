import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';

import { createProxyServer, HTTP_STATUS, RESPONSE_CODES } from '../src/proxy/server.js';

const TOKEN = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

let server: http.Server;
let baseUrl = '';
let recreateCalls = 0;
let lastPullImage: boolean | undefined;

interface ProxyTestResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: {
    ok: boolean;
    code: string;
    error?: string;
  };
}

function listen(serverToStart: http.Server): Promise<void> {
  return new Promise(resolve => {
    serverToStart.listen(0, '127.0.0.1', resolve);
  });
}

function close(serverToClose: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    serverToClose.close(err => err ? reject(err) : resolve());
  });
}

async function proxyRequest(
  method: string,
  path: string,
  body?: string,
  headers: Record<string, string> = {},
): Promise<ProxyTestResponse> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    body,
  });

  return {
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    body: await res.json() as ProxyTestResponse['body'],
  };
}

before(async () => {
  server = createProxyServer({
    token: TOKEN,
    recreate: async (container, _env, _removed, pullImage) => {
      recreateCalls += 1;
      lastPullImage = pullImage;
      if (container === 'boom') throw new Error('docker failed');
    },
  });
  await listen(server);
  const address = server.address();
  assert(address && typeof address === 'object');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await close(server);
});

test('proxy returns 404 route_not_found for unknown endpoints', async () => {
  const res = await proxyRequest('POST', '/unknown', '{}', { 'x-proxy-token': TOKEN });

  assert.equal(res.status, HTTP_STATUS.NOT_FOUND);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, RESPONSE_CODES.ROUTE_NOT_FOUND);
});

test('proxy returns 405 method_not_allowed for non-POST /recreate requests', async () => {
  const res = await proxyRequest('GET', '/recreate');

  assert.equal(res.status, HTTP_STATUS.METHOD_NOT_ALLOWED);
  assert.equal(res.headers.allow, 'POST');
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, RESPONSE_CODES.METHOD_NOT_ALLOWED);
});

test('proxy returns 401 unauthorized before reading the body', async () => {
  const res = await proxyRequest('POST', '/recreate', '{"container":"app"}');

  assert.equal(res.status, HTTP_STATUS.UNAUTHORIZED);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, RESPONSE_CODES.UNAUTHORIZED);
});

test('proxy returns 400 invalid_json for malformed JSON', async () => {
  const res = await proxyRequest('POST', '/recreate', '{bad json', { 'x-proxy-token': TOKEN });

  assert.equal(res.status, HTTP_STATUS.BAD_REQUEST);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, RESPONSE_CODES.INVALID_JSON);
});

test('proxy returns 413 payload_too_large for oversized bodies', async () => {
  const payload = JSON.stringify({ container: 'app', env: { BIG: 'x'.repeat(1024 * 1024) } });
  const res = await proxyRequest('POST', '/recreate', payload, { 'x-proxy-token': TOKEN });

  assert.equal(res.status, HTTP_STATUS.PAYLOAD_TOO_LARGE);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, RESPONSE_CODES.PAYLOAD_TOO_LARGE);
});

test('proxy returns 422 validation_failed for semantically invalid recreate payloads', async () => {
  const res = await proxyRequest('POST', '/recreate', '{"container":""}', { 'x-proxy-token': TOKEN });

  assert.equal(res.status, HTTP_STATUS.UNPROCESSABLE_ENTITY);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, RESPONSE_CODES.VALIDATION_FAILED);
});

test('proxy returns 500 recreate_failed when docker recreation fails', async () => {
  const res = await proxyRequest('POST', '/recreate', '{"container":"boom"}', { 'x-proxy-token': TOKEN });

  assert.equal(res.status, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, RESPONSE_CODES.RECREATE_FAILED);
});

test('proxy returns 200 ok after successful recreation', async () => {
  const beforeCalls = recreateCalls;
  const res = await proxyRequest('POST', '/recreate?trace=1', '{"container":"app"}', { 'x-proxy-token': TOKEN });

  assert.equal(res.status, HTTP_STATUS.OK);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.code, RESPONSE_CODES.OK);
  assert.equal(recreateCalls, beforeCalls + 1);
});

test('proxy forwards per-service pullImage to the recreate handler', async () => {
  const res = await proxyRequest(
    'POST',
    '/recreate',
    '{"container":"app","pullImage":true}',
    { 'x-proxy-token': TOKEN },
  );

  assert.equal(res.status, HTTP_STATUS.OK);
  assert.equal(lastPullImage, true);
});

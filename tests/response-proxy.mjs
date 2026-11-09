import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { startResponseProxy } from '../test-core/bench/response-proxy.mjs';

test('records one SSE response, then replays it offline and rejects uncaptured requests', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'response-proxy-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'responses.jsonl');
  let calls = 0;
  const sse = 'data: {"test":true}\n\ndata: [DONE]\n\n';
  const upstream = createServer((req, res) => {
    calls++;
    assert.equal(req.headers.authorization, 'Bearer test-key');
    req.resume();
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(sse);
  }).listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  t.after(() => upstream.close());
  const routes = { '/chat': { method: 'POST', upstream: 'http://127.0.0.1:' + upstream.address().port,
    headers: { Authorization: 'Bearer test-key' } } };
  const send = (proxy, body) => fetch(proxy.origin + '/chat', { method: 'POST', body: JSON.stringify(body) });
  const record = await startResponseProxy({ file, routes, mode: 'record', maxRequests: 1 });
  t.after(() => record.close());
  assert.equal(await (await send(record, { a: 1, b: 2 })).text(), sse);
  assert.equal((await send(record, { a: 3 })).status, 403);
  assert.equal(calls, 1);
  assert.doesNotMatch(await readFile(file, 'utf8'), /test-key/);
  const replay = await startResponseProxy({ file, routes });
  t.after(() => replay.close());
  const response = await send(replay, { b: 2, a: 1 });
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  assert.equal(await response.text(), sse);
  assert.equal((await send(replay, { a: 3 })).status, 404);
  assert.deepEqual(replay.stats, { hits: 1, misses: 1, outbound: 0, failures: 0 });
  assert.equal(calls, 1);
});

test('stops recording after an upstream quota response', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'response-proxy-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let calls = 0;
  const upstream = createServer((_req, res) => {
    calls++;
    res.writeHead(429);
    res.end();
  }).listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  t.after(() => upstream.close());
  const proxy = await startResponseProxy({
    file: join(dir, 'responses.jsonl'), mode: 'record', maxRequests: 10,
    routes: { '/search': { method: 'GET', upstream: 'http://127.0.0.1:' + upstream.address().port } },
  });
  t.after(() => proxy.close());
  assert.equal((await fetch(proxy.origin + '/search?q=one')).status, 429);
  assert.equal((await fetch(proxy.origin + '/search?q=two')).status, 403);
  assert.equal(calls, 1);
});

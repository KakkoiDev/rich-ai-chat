import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { once } from 'node:events';

const hash = data => createHash('sha256').update(data).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const MAX_BYTES = 16 * 1024 * 1024;

async function read(stream) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream ?? []) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_BYTES) throw Error('Response proxy body too large');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

/** Loopback cassette proxy. Only explicit routes may be forwarded, and only in record mode. */
export async function startResponseProxy({ file, routes, mode = 'replay', maxRequests = 0, timeoutMs = 60_000 }) {
  if (!['replay', 'record'].includes(mode)) throw Error('Invalid response proxy mode');
  if (mode === 'record' && (!Number.isSafeInteger(maxRequests) || maxRequests < 1)) throw Error('Recording needs a positive request budget');
  const contents = mode === 'record' && !existsSync(file) ? '' : readFileSync(file, 'utf8');
  const entries = new Map();
  for (const line of contents.split('\n').filter(Boolean)) {
    const { key, body, contentType } = JSON.parse(line);
    if (!/^[a-f0-9]{64}$/.test(key) || typeof body !== 'string' || typeof contentType !== 'string' || entries.has(key)) throw Error('Invalid or duplicate cassette entry');
    entries.set(key, { body, contentType });
  }
  const stats = { hits: 0, misses: 0, outbound: 0, failures: 0 };
  let quotaStopped = false;
  let pending = Promise.resolve();
  const server = createServer(async (req, res) => {
    const fail = (status, message) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message } }));
    };
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const route = Object.hasOwn(routes, url.pathname) ? routes[url.pathname] : undefined;
      if (!route || req.method !== route.method) { stats.failures++; return fail(404, 'Unknown response proxy route'); }
      const raw = await read(req);
      const query = [...url.searchParams].sort(([a], [b]) => a.localeCompare(b));
      const body = raw.length ? JSON.stringify(canonical(JSON.parse(raw))) : '';
      const key = hash(JSON.stringify([req.method, url.pathname, query, body]));
      async function answer() {
        let entry = entries.get(key);
        if (entry) stats.hits++;
        else if (mode === 'replay') { stats.misses++; return fail(404, 'No recorded response: ' + key); }
        else {
          if (quotaStopped || stats.outbound >= maxRequests) { stats.failures++; return fail(403, 'Recording budget exhausted'); }
          const upstream = new URL(route.upstream);
          upstream.search = url.search;
          stats.outbound++;
          const response = await fetch(upstream, { method: route.method, headers: route.headers, redirect: 'error',
            body: raw.length ? raw : undefined, signal: AbortSignal.timeout(timeoutMs) });
          if (response.status === 429) quotaStopped = true;
          if (!response.ok) {
            await response.body?.cancel();
            stats.failures++;
            return fail(response.status, 'Recording upstream returned HTTP ' + response.status);
          }
          entry = { contentType: response.headers.get('content-type') || 'application/octet-stream',
            body: (await read(response.body)).toString('base64') };
          appendFileSync(file, JSON.stringify({ key, ...entry }) + '\n', { mode: 0o600 });
          entries.set(key, entry);
        }
        res.writeHead(200, { 'Content-Type': entry.contentType });
        res.end(Buffer.from(entry.body, 'base64'));
      }
      if (mode === 'record') {
        const job = pending.then(answer);
        pending = job.catch(() => {});
        await job;
      } else await answer();
    } catch {
      stats.failures++;
      if (!res.headersSent) fail(502, 'Response proxy failed');
      else res.destroy();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { origin: 'http://127.0.0.1:' + server.address().port, digest: hash(contents), stats,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

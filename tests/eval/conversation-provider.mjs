import { createServer } from 'node:http';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// Frozen evidence for the conversation recipe case. Everything else goes through the
// benchmark cassette (including DeepSeek); this server has no external upstream.
export async function startConversationProvider(proxyOrigin) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/res/v1/web/search' && /\bpizza\b/i.test(url.searchParams.get('q') ?? '')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ web: { results: [{
          title: 'Weeknight pizza dough and baking instructions',
          url: 'https://recipes.example.test/weeknight-pizza',
          description: 'Mix 300 g flour, 200 ml water, 1 tsp yeast and 1 tsp salt. Knead and let rise 45 minutes. Stretch, add tomato sauce and mozzarella. Bake at 230°C for 12 minutes.',
        }] } }));
        return;
      }
      const replay = await fetch(proxyOrigin + url.pathname + url.search, {
        method: req.method, ...(req.method === 'POST' ? { body: Readable.toWeb(req), duplex: 'half' } : {}),
        signal: AbortSignal.timeout(120000),
      });
      res.writeHead(replay.status, { 'content-type': replay.headers.get('content-type') || 'application/json' });
      if (replay.body) await pipeline(Readable.fromWeb(replay.body), res);
      else res.end();
    } catch {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    }
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { origin: 'http://127.0.0.1:' + server.address().port, close: () => new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections();
  }) };
}

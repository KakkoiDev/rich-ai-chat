import { createServer } from 'node:http';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// Fixed benchmark snapshots keyed by topic, so reasonable variations in the
// model's search wording do not force a paid request. Unknown topics still
// have to match the replay cassette.
const searchEvidence = [
  [/\bpizza\b/i, 'pizza', 'Weeknight pizza dough and baking instructions',
    'Mix 300 g flour, 200 ml water, 1 tsp yeast and 1 tsp salt. Knead and let rise 45 minutes. Stretch, add tomato sauce and mozzarella. Bake at 230°C for 12 minutes.'],
  [/\bkiso\b/i, 'kiso', 'Kiso Observatory: Schmidt telescope and observatory code',
    'Kiso Observatory uses observatory code 381. The 105 cm Schmidt telescope began observations in 1974.'],
  [/\btokyo\b|東京/i, 'tokyo-weather', 'Tokyo weather bulletin — benchmark snapshot',
    'Tokyo: partly cloudy, 10°C, as of 12:00 on 15 January 2026. This fixed benchmark bulletin is not a live forecast.'],
  [/skytree|sky tree/i, 'skytree', 'Tokyo Skytree: history', 'Tokyo Skytree opened to the public in 2012.'],
  [/sydney.*opera|opera.*sydney/i, 'sydney-opera-house', 'Sydney Opera House: history', 'The Sydney Opera House opened in 1973.'],
  [/golden gate/i, 'golden-gate', 'Golden Gate Bridge: history', 'The Golden Gate Bridge opened in 1937.'],
  [/eiffel/i, 'eiffel-tower', 'Eiffel Tower: history', 'The Eiffel Tower was completed in 1889.'],
  [/louvre/i, 'louvre-pyramid', 'Louvre Pyramid: history', 'The Louvre Pyramid opened in 1989.'],
  [/akashi|kaikyo/i, 'akashi-bridge', 'Akashi Kaikyo Bridge: history', 'The Akashi Kaikyo Bridge opened in 1998.'],
  [/burj|khalifa/i, 'burj-khalifa', 'Burj Khalifa: history', 'Burj Khalifa opened in 2010.'],
  [/\bshard\b/i, 'shard', 'The Shard: history', 'The Shard was inaugurated in 2012.'],
];

export async function startConversationProvider(proxyOrigin) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const query = url.searchParams.get('q') ?? '';
      const fixture = req.method === 'GET' && url.pathname === '/res/v1/web/search' &&
        searchEvidence.find(([matches, id]) => matches.test(query) &&
          (id !== 'tokyo-weather' || /weather|temperature|forecast|conditions|天気/i.test(query)));
      if (fixture) {
        const [, id, title, description] = fixture;
        const source = id === 'pizza' ? 'https://recipes.example.test/weeknight-pizza' : 'https://search.example.test/' + id;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ web: { results: [{ title, url: source, description }] } }));
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

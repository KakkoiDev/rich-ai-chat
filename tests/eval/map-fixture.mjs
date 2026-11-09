import { createServer } from 'node:http';
import { once } from 'node:events';

export async function startMapFixture() {
  const places = new Map([
    ['Tokyo', [139.69, 35.68, [139.56, 35.82, 139.92, 35.52], 'Japan']],
    ['Mount Everest', [86.925, 27.988, [86.88, 28.02, 86.97, 27.95], 'Nepal']],
    ['Paris', [2.35, 48.86, [2.22, 48.91, 2.47, 48.81], 'France']],
  ]);
  const server = createServer((request, response) => {
    const { pathname, searchParams } = new URL(request.url, 'http://127.0.0.1');
    if (pathname === '/forecast') {
      const valid = Object.entries({ latitude: '48.86', longitude: '2.35', forecast_days: '8', timezone: 'auto',
        temperature_unit: 'celsius', daily: 'temperature_2m_min,temperature_2m_max' })
        .every(([key, value]) => searchParams.get(key) === value);
      response.writeHead(valid ? 200 : 400, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(valid ? { daily: {
        time: Array.from({ length: 8 }, (_, i) => `2026-01-${15 + i}`),
        temperature_2m_min: [0, -2, -1, 0, 2, 3, 1, 4],
        temperature_2m_max: [5, 4, 5, 6, 9, 11, 7, 12],
      } } : {}));
      return;
    }
    const query = searchParams.get('q');
    const label = [...places.keys()].find(name => name.toLowerCase() === query?.toLowerCase());
    const place = places.get(label);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ features: place ? [{ geometry: { type: 'Point', coordinates: place.slice(0, 2) },
      properties: { name: label, extent: place[2], country: place[3] } }] : [] }));
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = 'http://127.0.0.1:' + server.address().port;
  return { url, forecastUrl: url + '/forecast', close: () => new Promise(resolve => server.close(resolve)) };
}

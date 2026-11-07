/** The connection check's target: answers only when this server runs. The offline worker never caches /api/*. */
export function GET() {
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

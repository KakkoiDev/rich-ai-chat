# Recorded HTTP responses for benchmarks

Use `startResponseProxy({ file, routes })` from `response-proxy.mjs`. It returns a loopback `origin`, cassette `digest`, counters and an async `close()`. Point the application under test at this origin. Each route maps an exact local path to a method and, for recording, a fixed upstream URL and headers. The proxy never forwards client headers or follows redirects.

Replay is the default. It loads an immutable JSON Lines cassette at startup and serves exact matches by method, path, sorted query keys, and canonical JSON body. A miss returns 404 and increments `misses`; the runner should fail the case or task even if the application recovers. Keep the digest in the frozen run configuration. No upstream fetch is made in replay.

To capture synthetic fixtures, explicitly set `mode: 'record'` and a positive `maxRequests`. Existing matches replay; only misses spend the budget. Outbound attempts, including errors, count. Concurrent misses are serialized, and a 429 stops further outbound calls. Recordings contain hashes and successful response bytes, including SSE framing; response timing and chunk boundaries are not simulated. Use separate benchmark credentials, synthetic inputs only, and review response content before sharing any cassette. Close the proxy in a `finally` block.

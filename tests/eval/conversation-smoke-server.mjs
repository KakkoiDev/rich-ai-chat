// Isolated app server for conversation smoke. Brave uses synthetic evidence;
// Paid calls replay by default; explicit, budgeted recording goes through the same proxy.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { startConversationProvider } from './conversation-provider.mjs';
import { once } from 'node:events';
import { paidProxy } from './paid-proxy.mjs';
import { startMapFixture } from './map-fixture.mjs';

const port = Number(process.env.EVAL_PORT || 3257);
const appEnv = { ...process.env, EVAL_BRAVE_SEARCH_API_KEY: '', EVAL_DEEPSEEK_API_KEY: '' };
assert.notEqual(port, 3212, 'Do not use the live app port');
const proxy = await paidProxy(process.env);
const maps = await startMapFixture();
const fixture = await startConversationProvider(proxy.origin);
const origin = fixture.origin;
try {
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', String(port)], {
    stdio: 'inherit', env: { ...appEnv, RICH_CHAT_BUILD_DIR: process.env.RICH_CHAT_BUILD_DIR || '.next-local/conversation-smoke', NEXT_TELEMETRY_DISABLED: '1',
      RICH_CHAT_LOG_DIR: 'off', RICH_CHAT_PAID_PROXY: origin, BRAVE_SEARCH_API_KEY: 'fixture', DEEPSEEK_API_KEY: 'fixture',
      MODEL_BASE_URL: 'http://127.0.0.1:11434/v1', MODEL_API_KEY: 'fixture',
      RICH_CHAT_GEOCODER_URL: maps.url, RICH_CHAT_FORECAST_URL: maps.forecastUrl, RICH_CHAT_EVAL_CLOCK: '2026-01-15T12:00:00Z' },
  });
  const stop = () => child.kill();
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  const [code] = await once(child, 'exit');
  process.exitCode = code ?? 0;
} finally {
  console.log('[conversation smoke] paid replay', JSON.stringify(proxy.stats));
  await Promise.all([fixture.close(), maps.close(), proxy.close()]);
}

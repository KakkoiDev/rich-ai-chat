import path from 'node:path';
import { homedir } from 'node:os';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

export async function paidProxy(env) {
  const { startResponseProxy } = await import('../../test-core/bench/response-proxy.mjs');
  const mode = env.EVAL_PAID_MODE || 'replay';
  const file = path.resolve(env.EVAL_PAID_CASSETTE || path.join(env.RICH_CHAT_BENCH_ROOT ||
    path.join(homedir(), 'Library', 'Application Support', 'Rich AI Chat Benchmarks'), 'paid-api.jsonl'));
  const record = mode === 'record';
  if (mode === 'replay' && !existsSync(file)) throw Error('Missing paid API cassette: ' + file);
  const brave = record ? env.EVAL_BRAVE_SEARCH_API_KEY : undefined;
  const deepseek = record ? env.EVAL_DEEPSEEK_API_KEY : undefined;
  const liveFile = env.RICH_CHAT_ENV_FILE || '/Library/Application Support/Rich AI Chat/.env';
  const live = record && existsSync(liveFile) ? parseEnv(readFileSync(liveFile, 'utf8')) : {};
  if (record && (!brave || !deepseek)) throw Error('Recording requires both EVAL_ provider keys');
  const shared = [env.BRAVE_SEARCH_API_KEY, live.BRAVE_SEARCH_API_KEY].includes(brave) ||
    [env.DEEPSEEK_API_KEY, env.MODEL_API_KEY, live.DEEPSEEK_API_KEY, live.MODEL_API_KEY].includes(deepseek);
  if (record && shared && env.EVAL_ALLOW_SHARED_PAID_KEYS !== '1') {
    throw Error('Recording with shared keys requires EVAL_ALLOW_SHARED_PAID_KEYS=1');
  }
  const routes = Object.fromEntries(['web', 'images', 'videos'].map(kind => {
    const endpoint = '/res/v1/' + kind + '/search';
    return [endpoint, { method: 'GET', upstream: 'https://api.search.brave.com' + endpoint,
      headers: { 'X-Subscription-Token': brave } }];
  }));
  routes['/chat/completions'] = { method: 'POST', upstream: 'https://api.deepseek.com/chat/completions',
    headers: { Authorization: 'Bearer ' + deepseek, 'Content-Type': 'application/json' } };
  const proxy = await startResponseProxy({ file, routes, mode, maxRequests: Number(env.EVAL_PAID_MAX_REQUESTS || 0) });
  return { ...proxy, mode };
}

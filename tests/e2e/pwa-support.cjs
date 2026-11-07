/* eslint-disable @typescript-eslint/no-require-imports -- optional Playwright is resolved via NODE_PATH for these standalone checks. */
// Shared by the M6 and M7 checks (export-install.cjs, chat-pwa.cjs): free ports, a stub model, the built chat, a
// throwaway Caddy running deploy/caddy/exports.caddy, full Chromium on a throwaway profile, and test-core's pinned
// PWA checks (test-core/pwa/pwa.mjs, recipe pwa-offline).
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { pathToFileURL } = require('node:url');

const repo = path.resolve(__dirname, '../..');
const pwa = () => import(pathToFileURL(path.join(repo, 'test-core/pwa/pwa.mjs')).href);

const freePort = () => new Promise(done => {
  const server = net.createServer().listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => done(port)); });
});

function chunk(delta, finish = null) {
  return 'data: ' + JSON.stringify({ id: 'stub', object: 'chat.completion.chunk', created: 0, model: 'stub-model',
    choices: [{ index: 0, delta, finish_reason: finish }] }) + '\n\n';
}

/** A stub model in the OpenAI streaming format: it answers every prompt with a card naming the prompt's last word. */
async function startStubModel() {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', data => { body += data; });
    req.on('end', () => {
      const request = JSON.parse(body || '{}');
      const user = [...(request.messages ?? [])].reverse().find(m => m.role === 'user');
      const prompt = typeof user?.content === 'string' ? user.content : JSON.stringify(user?.content ?? '');
      const word = /([A-Za-z]+)\W*$/.exec(prompt)?.[1] ?? 'nothing';
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(chunk({ role: 'assistant', content: `root = Card([TextContent(${JSON.stringify(`Stub reply to ${word}.`)})])` }));
      res.write(chunk({}, 'stop'));
      res.end('data: [DONE]\n\n');
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { url: `http://127.0.0.1:${server.address().port}/v1`, close: () => new Promise(done => server.close(done)) };
}

/** The built chat (RICH_CHAT_BUILD_DIR) on a port of its own, with the given settings; resolves once it is Ready. */
async function startChat({ port, modelURL, env = {} }) {
  assert.ok(process.env.RICH_CHAT_BUILD_DIR, 'Set RICH_CHAT_BUILD_DIR to a built app');
  const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: repo,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', RICH_CHAT_LOG_DIR: 'off', BRAVE_SEARCH_API_KEY: '',
      MODEL_BASE_URL: modelURL ?? 'http://127.0.0.1:9/v1', MODEL_ID: 'stub-model', MODEL_API_KEY: 'stub', ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  for await (const data of app.stdout) if (String(data).includes('Ready')) break;
  const stopped = once(app, 'exit');
  return { url: `http://127.0.0.1:${port}`, stop: async () => { app.kill(); await stopped; } };
}

/** Caddy: RICH_CHAT_CADDY, else `caddy` on PATH, else the host's copy beside tailscaled. */
function findCaddy() {
  const candidates = [process.env.RICH_CHAT_CADDY, 'caddy', '/Library/Application Support/App Home Caddy/caddy'].filter(Boolean);
  for (const candidate of candidates) {
    if (spawnSync(candidate, ['version'], { stdio: 'ignore' }).status === 0) return candidate;
  }
  throw new Error('No Caddy found: set RICH_CHAT_CADDY to a caddy binary.');
}

/**
 * A throwaway Caddy serving deploy/caddy/exports.caddy exactly as committed, imported the way the docs tell the owner
 * to, on its own port, with its own config and data folders (it never touches the host's Caddy or its state).
 */
async function startExportOrigin({ port, exportsDir, scratch }) {
  const caddy = findCaddy();
  const site = path.join(repo, 'deploy/caddy/exports.caddy');
  const config = path.join(scratch, 'Caddyfile');
  fs.writeFileSync(config, `{\n\tadmin off\n\tpersist_config off\n\tstorage file_system ${JSON.stringify(path.join(scratch, 'storage'))}\n}\n`
    + `import ${JSON.stringify(site)} ${port} ${JSON.stringify(exportsDir)}\n`);
  const env = { ...process.env, XDG_CONFIG_HOME: path.join(scratch, 'config'), XDG_DATA_HOME: path.join(scratch, 'data') };
  const validated = spawnSync(caddy, ['validate', '--adapter', 'caddyfile', '--config', config], { env, encoding: 'utf8' });
  assert.equal(validated.status, 0, `caddy validate failed:\n${validated.stderr}`);
  const server = spawn(caddy, ['run', '--adapter', 'caddyfile', '--config', config], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  let log = '';
  for await (const data of server.stderr) {
    log += data;
    if (log.includes('serving initial configuration')) break;
  }
  server.stderr.resume();
  const stopped = once(server, 'exit');
  return { url: `http://127.0.0.1:${port}`, stop: async () => { server.kill(); await stopped; } };
}

/**
 * Full Chromium (not the headless shell, which reports every page installable) on a throwaway persistent profile (a
 * fresh incognito-like context would add "in-incognito" to the installability check).
 */
async function launchProfile(scratch, options = {}) {
  const profile = fs.mkdtempSync(path.join(scratch, 'profile-'));
  return chromium.launchPersistentContext(profile, {
    channel: 'chromium', args: ['--use-mock-keychain', '--password-store=basic'], viewport: { width: 1280, height: 900 }, ...options,
  });
}

/** Plain HTTP GET (no browser): status, headers and body. */
function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', data => { body += data; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
    }).on('error', reject);
  });
}

function scratchFolder(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `rich-chat-${name}-`));
}

const checks = [];
async function check(name, body) {
  await body();
  checks.push(name);
  console.log('PASS: ' + name);
}

module.exports = { repo, pwa, freePort, startStubModel, startChat, startExportOrigin, launchProfile, get, scratchFolder, check, checks };

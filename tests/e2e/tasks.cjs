/* eslint-disable @typescript-eslint/no-require-imports -- optional Playwright is resolved via NODE_PATH for this standalone check. */
// M9/M10 deterministic checks in the browser: the Tasks panel, the plan tools the model calls, and background jobs run
// by the worker process beside the server. A stub model speaks the OpenAI format, so no real model is involved.
//   RICH_CHAT_BUILD_DIR=.next-local/<build> NODE_PATH=<folder with playwright> node tests/e2e/tasks.cjs
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');

assert.ok(process.env.RICH_CHAT_BUILD_DIR, 'Set RICH_CHAT_BUILD_DIR to a built app');
const root = path.join(__dirname, '../..');
const seen = { tools: new Set(), jobSteps: [] };

function chunk(delta, finish = null) {
  return 'data: ' + JSON.stringify({ id: 'stub', object: 'chat.completion.chunk', created: 0, model: 'stub-model',
    choices: [{ index: 0, delta, finish_reason: finish }] }) + '\n\n';
}

/** The stub model. Chat requests name a scenario; worker requests start with "Job:". */
function stubModel(req, res) {
  let body = '';
  req.on('data', data => { body += data; });
  req.on('end', () => {
    const request = JSON.parse(body || '{}');
    const messages = request.messages ?? [];
    const user = [...messages].reverse().find(m => m.role === 'user');
    const prompt = typeof user?.content === 'string' ? user.content : JSON.stringify(user?.content ?? '');
    if (prompt.startsWith('Job: ')) {
      seen.jobSteps.push(prompt.split('\n').slice(0, 2).join(' / '));
      if (prompt.startsWith('Job: Slow')) return; // never answers; the job is cancelled
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ id: 'stub', object: 'chat.completion', created: 0, model: request.model,
        choices: [{ index: 0, message: { role: 'assistant', content: 'Done: ' + prompt.split('\n')[1] }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
    }
    for (const t of request.tools ?? []) seen.tools.add(t.function?.name);
    const system = messages.find(m => m.role === 'system')?.content ?? '';
    const firstOpenId = /"next":\[\{"id":"([^"]+)"/.exec(typeof system === 'string' ? system : '')?.[1];
    const scenario = /scenario ([a-z-]+)/.exec(prompt)?.[1] ?? 'plain';
    const afterTool = messages.some(m => m.role === 'tool');
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const answer = text => {
      res.write(chunk({ role: 'assistant', content: `root = Card([TextContent(${JSON.stringify(text)})])` }));
      res.write(chunk({}, 'stop'));
      res.end('data: [DONE]\n\n');
    };
    const call = (name, args) => {
      res.write(chunk({ role: 'assistant', tool_calls: [{ index: 0, id: `call_${scenario}_${Date.now()}`, type: 'function',
        function: { name, arguments: JSON.stringify(args) } }] }));
      res.write(chunk({}, 'tool_calls'));
      res.end('data: [DONE]\n\n');
    };
    if (afterTool) return answer(`Done with ${scenario}.`);
    if (scenario === 'plan') return call('propose_items', { objective: 'Prepare the field-trip handout',
      items: ['Draft the packing list', 'Print 30 copies'], sequential: true });
    if (scenario === 'verify-missing') return call('record_verification', { itemId: firstOpenId, evidence: [] });
    if (scenario === 'verify') return call('record_verification', { itemId: firstOpenId, evidence: [{ kind: 'artifact', ref: 'packing-list-v1.md' }] });
    if (scenario === 'checkpoint') return call('record_checkpoint', { note: 'Packing list drafted; printing is next' });
    return answer('Plain answer.');
  });
}

const freePort = () => new Promise(resolve => {
  const probe = net.createServer().listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});

async function startApp(port, modelPort, dataDir) {
  const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: root,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', MODEL_BASE_URL: `http://127.0.0.1:${modelPort}/v1`, MODEL_ID: 'stub-model',
      MODEL_API_KEY: 'stub', RICH_CHAT_LOG_DIR: 'off', RICH_CHAT_DATA_DIR: dataDir, BRAVE_SEARCH_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  for await (const data of app.stdout) if (String(data).includes('Ready')) break;
  return app;
}

function startWorker(modelPort, dataDir) {
  return spawn(process.execPath, ['scripts/task-worker.mjs'], {
    cwd: root,
    env: { ...process.env, RICH_CHAT_DATA_DIR: dataDir, RICH_CHAT_LOG_DIR: 'off', RICH_CHAT_WORKER_MODEL_BASE_URL: `http://127.0.0.1:${modelPort}/v1`,
      RICH_CHAT_WORKER_LEASE_MS: '4000', RICH_CHAT_WORKER_HEARTBEAT_MS: '200', RICH_CHAT_WORKER_POLL_MS: '100' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

const checks = [];
async function check(name, body) {
  await body();
  checks.push(name);
  console.log('PASS: ' + name);
}

(async () => {
  const model = http.createServer(stubModel);
  model.listen(0, '127.0.0.1');
  await once(model, 'listening');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rich-chat-tasks-e2e-'));
  const downloads = fs.mkdtempSync(path.join(os.tmpdir(), 'rich-chat-tasks-export-'));
  const port = Number(process.env.TASKS_PORT) || await freePort();
  const app = await startApp(port, model.address().port, dataDir);
  const worker = startWorker(model.address().port, dataDir);
  const browser = await chromium.launch({ args: ['--use-mock-keychain', '--password-store=basic'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    let threadId;
    page.on('request', request => {
      if (request.url().endsWith('/api/chat') && request.method() === 'POST') threadId = JSON.parse(request.postData() || '{}').threadId ?? threadId;
    });
    await page.goto(`http://127.0.0.1:${port}/`);
    const replies = () => page.locator('.reply-activity');
    const ask = async (text, count) => {
      const box = page.getByRole('textbox', { name: 'Message' });
      await box.fill(text);
      await box.press('Enter');
      await page.waitForFunction(n => [...document.querySelectorAll('.reply-activity summary')].length >= n
        && !/working…/.test(document.querySelectorAll('.reply-activity summary')[n - 1].textContent), count);
    };
    const panel = page.getByRole('complementary', { name: 'Tasks' });
    const openPanel = async () => {
      if (!(await panel.count())) await page.getByRole('button', { name: /^Tasks/ }).click();
      await panel.waitFor();
    };
    const items = () => panel.getByTestId('task-item');
    const api = (body) => page.evaluate(async body => {
      const response = await fetch('/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json',
        'x-rich-chat-profile': localStorage.getItem('rich-ai-chat:profile') }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    }, body);

    await check('The agent proposes a two-step plan and the panel shows it', async () => {
      await ask('Make a plan with two todos for the field-trip handout (scenario plan).', 1);
      assert.ok(threadId, 'The chat request names its thread');
      assert.ok(seen.tools.has('propose_items') && seen.tools.has('record_verification'), 'Plan tools are offered when a plan is asked for');
      await openPanel();
      await panel.getByTestId('task-objective').filter({ hasText: 'Prepare the field-trip handout' }).waitFor();
      assert.deepEqual(await items().locator('[class*=title]').allInnerTexts(), ['Draft the packing list', 'Print 30 copies']);
      assert.match(await items().nth(1).innerText(), /After: Draft the packing list/);
      assert.match(await replies().last().locator('summary').innerText(), /1 proposal/);
    });

    await check('A verification without evidence is refused and the step stays open', async () => {
      await ask('Mark the first todo done (scenario verify-missing).', 2);
      // The open panel covers the reply column, so read the reply's Activity line without clicking it.
      const lines = await replies().last().evaluate(element => { element.open = true; return element.textContent; });
      assert.match(lines, /Recorded a verification, but it failed: A verification needs evidence/);
      assert.match(await items().first().innerText(), /To do/);
    });

    await check('The agent completes step one with evidence and records a checkpoint', async () => {
      await ask('The packing list is written (scenario verify).', 3);
      await ask('Note where we are (scenario checkpoint).', 4);
      await items().first().filter({ hasText: 'Done' }).waitFor();
      assert.match(await items().first().innerText(), /Evidence \(artifact\): packing-list-v1\.md/);
      await panel.getByTestId('task-checkpoint').filter({ hasText: 'Packing list drafted; printing is next (agent)' }).waitFor();
    });

    await check('A concurrent edit is refused instead of being overwritten', async () => {
      const plan = (await api({ action: 'add', chat: threadId, title: 'Hand out copies' })).body.plan;
      const second = plan.items[1];
      await items().nth(2).waitFor();
      // One writer renames step two; a second writer that read the same version is refused, then retries fresh.
      const renamed = await api({ action: 'edit', chat: threadId, itemId: second.id, title: 'Print 32 copies', version: second.version });
      assert.equal(renamed.status, 200);
      const stale = await api({ action: 'event', chat: threadId, itemId: second.id, event: 'start', version: second.version });
      assert.equal(stale.status, 409);
      assert.match(stale.body.error, /changed since it was read \(version 1, now 2\)/);
      assert.equal(stale.body.plan.items[1].title, 'Print 32 copies', 'The refusal carries the current plan');
      const fresh = await api({ action: 'event', chat: threadId, itemId: second.id, event: 'start', version: 2 });
      assert.equal(fresh.status, 200);
      await items().nth(1).filter({ hasText: 'Print 32 copies' }).filter({ hasText: 'In progress' }).waitFor();
    });

    await check('An illegal move is refused with its reason, and the panel shows it', async () => {
      const third = (await api({ action: 'add', chat: threadId, title: 'Collect permission slips' })).body.plan.items[3];
      const illegal = await api({ action: 'event', chat: threadId, itemId: third.id, event: 'reopen' });
      assert.equal(illegal.status, 409);
      assert.match(illegal.body.error, /Cannot reopen from pending \(allowed: start, block, cancel\)/);
      const row = items().filter({ hasText: 'Collect permission slips' });
      await row.getByRole('button', { name: 'Mark done…' }).count().then(count => assert.equal(count, 0, 'Done is not offered before starting'));
      await row.getByRole('button', { name: 'Block…' }).click();
      await row.getByRole('button', { name: 'Block', exact: true }).click();
      await panel.getByRole('alert').filter({ hasText: 'Reason is required' }).waitFor();
    });

    await check('Background jobs: waiting reason, cancellation and Activity progress in the panel', async () => {
      const slow = await api({ action: 'queue-job', chat: threadId, title: 'Slow summary', steps: ['wait forever'], model: 'gemma4:e2b-mlx' });
      assert.equal(slow.status, 200);
      await api({ action: 'queue-job', chat: threadId, title: 'Quick notes', steps: ['first part', 'second part'], model: 'gemma4:e2b-mlx' });
      const jobs = panel.getByTestId('task-job');
      await jobs.filter({ hasText: 'Slow summary' }).filter({ hasText: 'Running' }).waitFor();
      await jobs.filter({ hasText: 'Quick notes' }).getByTestId('job-reason')
        .filter({ hasText: 'Waiting for gemma4:e2b-mlx: one generation at a time on this local model' }).waitFor();
      await jobs.filter({ hasText: 'Slow summary' }).getByRole('button', { name: 'Cancel job' }).click();
      await jobs.filter({ hasText: 'Slow summary' }).filter({ hasText: 'Cancelled' }).waitFor();
      const quick = jobs.filter({ hasText: 'Quick notes' });
      await quick.filter({ hasText: 'Succeeded' }).waitFor();
      const text = await quick.innerText();
      assert.match(text, /Step 2 of 2 committed/);
      assert.match(text, /Checkpoint · step 2 of 2/);
      assert.match(text, /Succeeded · step 2 of 2 · 2 steps done/);
      assert.deepEqual(seen.jobSteps.filter(step => step.startsWith('Job: Quick')).length, 2);
      if (process.env.TASKS_SCREENSHOT) await page.screenshot({ path: process.env.TASKS_SCREENSHOT });
    });

    await check('Export downloads the plan as Markdown', async () => {
      const [file] = await Promise.all([page.waitForEvent('download'), panel.getByRole('button', { name: 'Export Markdown' }).click()]);
      const target = path.join(downloads, file.suggestedFilename());
      await file.saveAs(target);
      const markdown = fs.readFileSync(target, 'utf8');
      assert.equal(file.suggestedFilename(), 'prepare-the-field-trip-handout.md');
      assert.match(markdown, /- \[x\] Draft the packing list — done\n {2}- evidence: artifact `packing-list-v1\.md`/);
      assert.match(markdown, /- \[ \] Print 32 copies — in progress/);
      assert.match(markdown, /Packing list drafted; printing is next/);
      assert.match(markdown, /## Change log/);
    });

    await check('Reopening the chat shows the remaining step and the checkpoint', async () => {
      await page.reload();
      await page.getByRole('button', { name: 'Expand sidebar' }).click();
      await page.getByRole('button', { name: /^Make a plan with two todos/ }).click();
      await openPanel();
      await items().first().filter({ hasText: 'Done' }).waitFor();
      assert.match(await items().nth(1).innerText(), /Print 32 copies[\s\S]*In progress/);
      await panel.getByTestId('task-checkpoint').filter({ hasText: 'Job “Quick notes”: step 2 of 2 done (worker)' }).waitFor();
      await panel.getByTestId('task-job').filter({ hasText: 'Quick notes' }).filter({ hasText: 'Succeeded' }).waitFor();
    });

    await check('Another browser profile cannot see or change this plan', async () => {
      const other = await browser.newContext();
      const stranger = await other.newPage();
      await stranger.goto(`http://127.0.0.1:${port}/`);
      await stranger.getByRole('button', { name: /^Tasks/ }).waitFor();
      const result = await stranger.evaluate(async chat => {
        const headers = { 'x-rich-chat-profile': localStorage.getItem('rich-ai-chat:profile'), 'content-type': 'application/json' };
        const read = await (await fetch(`/api/tasks?chat=${encodeURIComponent(chat)}`, { headers })).json();
        const exported = await fetch(`/api/tasks/export?chat=${encodeURIComponent(chat)}`, { headers });
        return { plan: read.plan, exported: exported.status };
      }, threadId);
      assert.equal(result.plan, null);
      assert.equal(result.exported, 404);
      const owner = (await api({ action: 'add', chat: threadId, title: 'still mine' })).body.plan;
      const write = await stranger.evaluate(async ({ chat, itemId }) => {
        const response = await fetch('/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json',
          'x-rich-chat-profile': localStorage.getItem('rich-ai-chat:profile') },
          body: JSON.stringify({ action: 'event', chat, itemId, event: 'cancel' }) });
        return response.status;
      }, { chat: threadId, itemId: owner.items[0].id });
      assert.equal(write, 404);
      await other.close();
    });
  } finally {
    await browser.close();
    worker.kill('SIGTERM');
    app.kill();
    model.close();
  }
  console.log(`${checks.length} task checks passed.`);
})().catch(error => {
  console.error(error);
  process.exit(1);
});

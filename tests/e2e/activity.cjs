/* eslint-disable @typescript-eslint/no-require-imports -- optional Playwright is resolved via NODE_PATH for this standalone check. */
// M2 deterministic checks: Activity for each reply, driven by a stub model that speaks the OpenAI streaming format, so
// retries, dropped connections and cancellation happen on cue. It starts the stub and the built app itself:
//   RICH_CHAT_BUILD_DIR=.next-local/<build> node tests/e2e/activity.cjs   (Playwright via NODE_PATH)
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');

assert.ok(process.env.RICH_CHAT_BUILD_DIR, 'Set RICH_CHAT_BUILD_DIR to a built app');
const MARKER = 'zebra-7731'; // in every prompt; must never reach the server log or the export
const DEBUG_MARKER = 'heron-4096'; // only in the debugged chat; reaches its Activity and the debug file only
const calls = new Map(); // scenario -> number of model requests

function chunk(delta, finish = null) {
  return 'data: ' + JSON.stringify({ id: 'stub', object: 'chat.completion.chunk', created: 0, model: 'stub-model',
    choices: [{ index: 0, delta, finish_reason: finish }] }) + '\n\n';
}

/** The stub model. The scenario is named in the user's prompt; the request count picks the step. */
function stubModel(req, res) {
  if (req.url.startsWith('/geo?')) {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ features: [{ geometry: { type: 'Point', coordinates: [139.7, 35.6] },
      properties: { name: '東京都', country: '日本', type: 'city' } }] }));
  }
  if (req.url.startsWith('/res/v1/web/search?')) {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ web: { results: [{ title: 'Fixture study', url: 'https://example.org/study', description: 'The data did not support the claim.' }] } }));
  }
  let body = '';
  req.on('data', data => { body += data; });
  req.on('end', () => {
    const request = JSON.parse(body || '{}');
    const user = [...(request.messages ?? [])].reverse().find(m => m.role === 'user');
    const prompt = typeof user?.content === 'string' ? user.content : JSON.stringify(user?.content ?? '');
    const scenario = /scenario ([a-z-]+)/.exec(prompt)?.[1] ?? 'plain';
    if (!request.stream && scenario === 'search-summary') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ id: 'fixture', object: 'chat.completion', created: 0, model: 'stub-model',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant',
          content: 'root = Card([MarkDownRenderer("The study did not support the specific claim.")])' } }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }));
    }
    const n = (calls.get(scenario) ?? 0) + 1;
    calls.set(scenario, n);
    const afterTool = (request.messages ?? []).some(m => m.role === 'tool');
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const answer = text => {
      res.write(chunk({ role: 'assistant', content: `root = Card([TextContent(${JSON.stringify(text)})])` }));
      res.write(chunk({}, 'stop'));
      res.end('data: [DONE]\n\n');
    };
    const plain = text => {
      if (text) res.write(chunk({ role: 'assistant', content: text }));
      res.write(chunk({}, 'stop'));
      res.end('data: [DONE]\n\n');
    };
    if (scenario === 'visible-markdown') return plain('**The actual answer:** 東京');
    if (scenario === 'visible-retry') return n === 1 ? plain('root = Card([])') : plain('Recovered answer after empty markup.');
    if (scenario === 'visible-empty') return plain('');
    const callClock = () => {
      res.write(chunk({ role: 'assistant', tool_calls: [{ index: 0, id: `call_${scenario}_${n}`, type: 'function',
        function: { name: 'current_datetime', arguments: '{}' } }] }));
      res.write(chunk({}, 'tool_calls'));
      res.end('data: [DONE]\n\n');
    };
    const callSearch = () => {
      res.write(chunk({ role: 'assistant', tool_calls: [{ index: 0, id: `call_${scenario}_${n}`, type: 'function',
        function: { name: 'web_search', arguments: JSON.stringify({ query: 'opening year of a bridge' }) } }] }));
      res.write(chunk({}, 'tool_calls'));
      res.end('data: [DONE]\n\n');
    };
    const drop = () => { res.write(chunk({ role: 'assistant', content: 'root = Card([Tex' })); res.socket.destroy(); };
    if (scenario === 'clock-ok') return afterTool ? answer('It is noon.') : callClock();
    if (scenario === 'map-adjust') {
      if (afterTool) return plain('');
      assert.ok(request.tools?.some(item => item.function.name === 'adjust_map'));
      assert.match(request.messages[0].content, /already has a visible map/);
      res.write(chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'map-adjust-1', type: 'function',
        function: { name: 'adjust_map', arguments: '{"direction":"out"}' } }] }));
      res.write(chunk({}, 'tool_calls'));
      return res.end('data: [DONE]\n\n');
    }
    if (scenario === 'search-summary') return afterTool ? plain('') : callSearch();
    if (scenario === 'search-fails') return afterTool ? answer('It opened in 1998, as far as I know.') : callSearch();
    if (scenario === 'retry-no-tool') return n === 1 ? drop() : answer('Second try worked.');
    if (scenario === 'tool-then-drop') return afterTool ? drop() : callClock();
    if (scenario === 'hang') { res.write(chunk({ role: 'assistant', content: '' })); return; } // never finishes
    return answer('Plain answer.');
  });
}

async function startApp(port, modelPort, logDir, extraEnv = {}) {
  const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', MODEL_BASE_URL: `http://127.0.0.1:${modelPort}/v1`, MODEL_ID: 'stub-model',
      MODEL_API_KEY: 'stub', RICH_CHAT_LOG_DIR: logDir, BRAVE_SEARCH_API_KEY: '', ...extraEnv },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  for await (const data of app.stdout) if (String(data).includes('Ready')) break;
  return app;
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
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rich-chat-activity-log-'));
  const downloads = fs.mkdtempSync(path.join(os.tmpdir(), 'rich-chat-activity-export-'));
  const port = Number(process.env.ACTIVITY_PORT || 3251);
  const app = await startApp(port, model.address().port, logDir);
  const browser = await chromium.launch({ args: ['--use-mock-keychain', '--password-store=basic'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    await page.goto(`http://127.0.0.1:${port}/`);
    const ask = async scenario => {
      const box = page.getByRole('textbox', { name: 'Message' });
      await box.fill(`Please answer scenario ${scenario} (${MARKER}).`);
      await box.press('Enter');
    };
    const activity = () => page.locator('.reply-activity').last();
    const openActivity = async () => {
      const panel = activity();
      if (!(await panel.evaluate(element => element.open))) await panel.locator('summary').click();
      return (await panel.locator('li').allInnerTexts()).join('\n');
    };

    await check('A tool that ran shows once, with its result and time', async () => {
      await ask('clock-ok');
      await activity().locator('summary').filter({ hasText: /1 clock reading · \d+\.\d s/ }).waitFor();
      const lines = await openActivity();
      assert.match(lines, /Answered in chat · model stub-model/);
      assert.match(lines, /Read the clock · Time zone [\w/+-]+ · \d+\.\d s/);
      assert.match(lines, /Finished in \d+\.\d s/);
      assert.equal((lines.match(/Read the clock/g) ?? []).length, 1);
      await page.getByText('Reasoning summary: not available for this model.').last().waitFor();
    });

    await check('A dropped connection before any tool retries once and says why', async () => {
      await ask('retry-no-tool');
      await activity().locator('summary').filter({ hasText: /no tools · 2 attempts · \d+\.\d s/ }).waitFor();
      const lines = await openActivity();
      assert.match(lines, /Attempt 1 stopped: the model's connection ended\. Trying again\./);
      assert.match(lines, /Attempt 2 started/);
      assert.equal(calls.get('retry-no-tool'), 2, 'The model was asked twice');
    });

    await check('A retry after a tool ran never shows a second execution', async () => {
      await ask('tool-then-drop');
      await activity().locator('summary').filter({ hasText: /1 clock reading · \d+\.\d s/ }).waitFor();
      const lines = await openActivity();
      assert.equal((lines.match(/Read the clock ·/g) ?? []).length, 1, 'One clock reading, not two');
      assert.match(lines, /Answered with the clock reading already taken/);
      assert.doesNotMatch(lines, /Attempt 2/);
    });

    await check('A failed search is shown as failed, and the answer says it was not checked', async () => {
      await ask('search-fails');
      await activity().locator('summary').filter({ hasText: /1 search · \d+\.\d s/ }).waitFor();
      const lines = await openActivity();
      assert.match(lines, /Searched the web, but it failed: Web search is not configured\./);
      await page.getByText('The web search failed, so this answer was not checked against sources.').last().waitFor();
    });

    await check('Cancelling shows Cancelled', async () => {
      await ask('hang');
      await activity().locator('summary').filter({ hasText: /working…/ }).waitFor();
      await page.getByRole('button', { name: 'Cancel message' }).click();
      await activity().locator('summary').filter({ hasText: /cancelled/ }).waitFor();
    });

    await check('Activity survives a reload and its export holds no prompt text', async () => {
      await page.reload();
      await page.getByRole('button', { name: 'Expand sidebar' }).click();
      await page.getByRole('button', { name: /^Please answer scenario clock-ok/ }).click();
      await page.locator('.reply-activity summary').filter({ hasText: /1 clock reading/ }).first().waitFor();
      const panel = page.locator('.reply-activity').first();
      if (!(await panel.evaluate(element => element.open))) await panel.locator('summary').click();
      const [file] = await Promise.all([page.waitForEvent('download'), panel.getByRole('button', { name: "Export this chat's log" }).click()]);
      const target = path.join(downloads, file.suggestedFilename());
      await file.saveAs(target);
      const lines = fs.readFileSync(target, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      assert.ok(lines.length >= 4, 'One line per request');
      assert.ok(lines.every(entry => entry.events.every(event => event.requestId)), 'Every event has its request id');
      assert.ok(!fs.readFileSync(target, 'utf8').includes(MARKER), 'No prompt text in the export');
    });

    await check('The server log records every request without prompt text', async () => {
      const log = fs.readdirSync(logDir).filter(name => name.startsWith('activity-')).map(name => fs.readFileSync(path.join(logDir, name), 'utf8')).join('');
      assert.ok(!fs.readdirSync(logDir).some(name => name.startsWith('debug-')), 'No debug file without the switch');
      const events = log.trim().split('\n').map(line => JSON.parse(line));
      assert.ok(events.filter(event => event.type === 'request').length >= 4);
      assert.ok(events.some(event => event.type === 'tool-end' && event.tool === 'current_datetime'));
      assert.ok(!log.includes(MARKER), 'No prompt text in the server log');
    });

    await check('The full log lists every request with its question and reply, and finds the problems', async () => {
      const log = await context.newPage();
      await log.goto(`http://127.0.0.1:${port}/log`);
      const rows = log.getByRole('list', { name: 'Requests' }).locator(':scope > li');
      await rows.first().waitFor();
      const all = await rows.count();
      assert.ok(all >= 5, `Every request is listed (${all})`);
      // Newest first: clock-ok is the oldest request with one clock reading.
      const clock = rows.filter({ has: log.locator('summary').filter({ hasText: /1 clock reading/ }) }).last();
      await clock.locator('summary').first().click();
      await clock.locator('pre').getByText(`Please answer scenario clock-ok (${MARKER}).`).waitFor();
      await clock.locator('pre').getByText('It is noon.').first().waitFor();
      // The hung request was cancelled just before a reload. Whether or not its end was saved in time, it must say how it
      // ended ("cancelled") or that no end was recorded, never that it is still working.
      assert.equal(await rows.filter({ hasText: /working…/ }).count(), 0);
      await rows.filter({ hasText: /cancelled|no end recorded/ }).first().waitFor();
      assert.match((await clock.locator('table').innerText()), /tool-end[\s\S]*Read the clock/);
      await log.getByRole('combobox', { name: 'Show' }).selectOption('problems');
      const problems = await rows.count();
      assert.ok(problems >= 3 && problems < all, `Only requests with problems (${problems} of ${all})`);
      assert.equal(await rows.filter({ hasText: /1 clock reading · \d+\.\d s$/ }).count(), 0);
      await log.close();
    });

    await check('Debug this chat records full text for that chat only', async () => {
      const fresh = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const debugPage = await fresh.newPage();
      debugPage.setDefaultTimeout(20000);
      await debugPage.goto(`http://127.0.0.1:${port}/`);
      await debugPage.getByRole('checkbox', { name: 'Debug this chat' }).check();
      const box = debugPage.getByRole('textbox', { name: 'Message' });
      await box.fill(`Please answer scenario search-fails (${DEBUG_MARKER}).`);
      await box.press('Enter');
      const panel = debugPage.locator('.reply-activity').last();
      await panel.locator('summary').filter({ hasText: /1 search · \d+\.\d s/ }).first().waitFor();
      await panel.locator('summary').first().click();
      const details = panel.getByRole('region', { name: 'Debug details' });
      for (const stage of ['user message', 'system prompt', 'web_search input', 'web_search output', 'reply as sent'])
        await details.locator('summary').filter({ hasText: new RegExp('^' + stage) }).first().waitFor();
      assert.match(await details.textContent(), /opening year of a bridge/, "The tool input is recorded in full");
      assert.ok(await debugPage.getByRole('checkbox', { name: 'Debug this chat' }).isChecked(), 'The switch stays on for this chat');
      assert.equal(await page.locator('.debug-details').count(), 0, 'Other chats have no debug details');
      const files = fs.readdirSync(logDir);
      const debugFile = files.filter(name => name.startsWith('debug-')).map(name => fs.readFileSync(path.join(logDir, name), 'utf8')).join('');
      assert.ok(debugFile.includes(DEBUG_MARKER), 'The debug file has the debugged chat');
      assert.ok(!debugFile.includes(MARKER), 'The debug file has nothing from other chats');
      const activityLog = files.filter(name => name.startsWith('activity-')).map(name => fs.readFileSync(path.join(logDir, name), 'utf8')).join('');
      assert.ok(!activityLog.includes(DEBUG_MARKER), 'The activity log stays free of text');
      await fresh.close();
    });

    await check('Deleting the chat deletes its Activity', async () => {
      const count = () => page.evaluate(() => new Promise(resolve => {
        const open = indexedDB.open('rich-ai-chat-activity');
        open.onsuccess = () => {
          const request = open.result.transaction('entries').objectStore('entries').count();
          request.onsuccess = () => { resolve(request.result); open.result.close(); };
        };
      }));
      assert.ok(await count() >= 4);
      await page.getByRole('button', { name: 'Chat actions' }).click();
      await page.getByRole('menuitem', { name: 'Delete' }).click();
      const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog')).getByRole('button', { name: 'Delete' });
      if (await confirm.count()) await confirm.click();
      await page.waitForFunction(() => !JSON.parse(localStorage.getItem('rich-ai-chat:threads') || '[]').length);
      await page.waitForFunction(() => new Promise(resolve => {
        const open = indexedDB.open('rich-ai-chat-activity');
        open.onsuccess = () => {
          const request = open.result.transaction('entries').objectStore('entries').count();
          request.onsuccess = () => { resolve(request.result === 0); open.result.close(); };
        };
      }));
      assert.equal(await count(), 0);
    });
    const sendVisible = async (scenario, expected) => {
      const box = page.getByRole('textbox').first();
      await box.fill(`Explain the example for scenario ${scenario}.`);
      await box.press('Enter');
      await page.getByText(expected).last().waitFor();
    };
    await check('new and previously saved Markdown replies are visible', async () => {
      await sendVisible('visible-markdown', /The actual answer:/);
      await page.getByText('東京', { exact: false }).last().waitFor();
      await page.waitForFunction(() => Object.keys(localStorage).some(key =>
        key.startsWith('rich-ai-chat:messages:') && localStorage.getItem(key)?.includes('The actual answer:')));
      await page.evaluate(() => {
        for (const key of Object.keys(localStorage).filter(key => key.startsWith('rich-ai-chat:messages:'))) {
          const messages = JSON.parse(localStorage.getItem(key));
          const reply = messages.find(message => message.role === 'assistant' && message.content?.includes('The actual answer:'));
          if (!reply) continue;
          reply.content = '**The actual answer:** 東京';
          localStorage.setItem(key, JSON.stringify(messages));
          return;
        }
        throw Error('No saved reply to convert to the legacy format');
      });
      await page.reload();
      const expand = page.getByRole('button', { name: 'Expand sidebar' });
      if (await expand.isVisible()) await expand.click();
      await page.getByRole('button', { name: /^Explain the example for scenario visible-markdown/ }).click();
      await page.getByText(/The actual answer:/).last().waitFor();
    });
    await check('invisible markup is retried and shows the recovered answer', async () => {
      await sendVisible('visible-retry', 'Recovered answer after empty markup.');
      assert.equal(calls.get('visible-retry'), 2);
    });
    await check('two empty completions show a clear message', async () => {
      await sendVisible('visible-empty', /finished without writing an answer/);
      assert.equal(calls.get('visible-empty'), 2);
    });
    const fixturePort = port + 1;
    const fixtureBase = `http://127.0.0.1:${model.address().port}`;
    const fixtureApp = await startApp(fixturePort, model.address().port, logDir, {
      BRAVE_SEARCH_API_KEY: 'fixture', RICH_CHAT_PAID_PROXY: fixtureBase, RICH_CHAT_GEOCODER_URL: fixtureBase + '/geo',
    });
    try {
      const fixturePage = await browser.newPage();
      await fixturePage.route('https://www.openstreetmap.org/**', route => route.fulfill({ body: 'Map fixture' }));
      await fixturePage.goto(`http://127.0.0.1:${fixturePort}/`);
      const send = async text => {
        const box = fixturePage.getByRole('textbox', { name: 'Message' });
        await box.fill(text);
        await box.press('Enter');
      };
      await check('zoom follow-ups reuse the most recent map, including through the model tool', async () => {
        const maps = fixturePage.locator('iframe[title^="Map of"]');
        const width = async index => {
          await maps.nth(index).waitFor();
          const bounds = new URL(await maps.nth(index).getAttribute('src')).searchParams.get('bbox').split(',').map(Number);
          return bounds[2] - bounds[0];
        };
        await send('Show me Tokyo on the map');
        const initial = await width(0);
        await send('zoom out');
        const wider = await width(1);
        await send('show the map with Tokyo and zoom out a little');
        const named = await width(2);
        await send('Give me a wider view of that same map, scenario map-adjust.');
        const adjusted = await width(3);
        assert.ok(initial < wider && wider < named && named < adjusted);
        assert.equal(calls.get('map-adjust'), 2);
      });
      await check('search recovery displays a readable summary above its sources', async () => {
        await send('Look into the claim for scenario search-summary.');
        const summary = fixturePage.getByText('The study did not support the specific claim.', { exact: true });
        const link = fixturePage.getByRole('link', { name: 'Source 1' }).last();
        await summary.waitFor();
        await link.waitFor();
        assert.ok((await summary.boundingBox()).y < (await link.boundingBox()).y);
        assert.equal(await fixturePage.getByText(/root = Card/).count(), 0);
        assert.equal(calls.get('search-summary'), 2);
      });
      await fixturePage.close();
    } finally {
      fixtureApp.kill();
    }
  } finally {
    await browser.close();
    app.kill();
    model.close();
    fs.rmSync(logDir, { recursive: true, force: true });
    fs.rmSync(downloads, { recursive: true, force: true });
  }
  console.log(`PASS: ${checks.length} Activity checks`);
})().catch(error => { console.error(error); process.exitCode = 1; });

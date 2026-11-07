// M10 end to end: the real worker process (scripts/task-worker.mjs) against a stub model that speaks the OpenAI
// format, so no model is called. The worker is killed with SIGKILL in the middle of a job; a second worker reclaims the
// expired lease and resumes from the last committed checkpoint without generating finished steps again.
//   node --test tests/e2e/worker-kill.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createJobs } from "../../src/lib/tasks/jobs.ts";
import { createTaskStore, taskDatabasePath } from "../../src/lib/tasks/store.ts";

const root = join(import.meta.dirname, "../..");
const profile = "profile-worker-kill-000000";

async function until(condition, what, bound = 30000) {
  const started = Date.now();
  while (!(await condition())) {
    if (Date.now() - started > bound) assert.fail(`Timed out waiting for ${what}`);
    await delay(25);
  }
}

/** The stub model: one reply per step. The first request for `hangOn` never answers (the worker is killed meanwhile). */
function stubModel(hangOn) {
  const calls = new Map();
  let hung = false;
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", data => { body += data; });
    req.on("end", () => {
      const request = JSON.parse(body || "{}");
      const prompt = request.messages?.findLast(message => message.role === "user")?.content ?? "";
      const step = /Step (\d+) of \d+/.exec(typeof prompt === "string" ? prompt : JSON.stringify(prompt))?.[1] ?? "?";
      calls.set(step, (calls.get(step) ?? 0) + 1);
      if (step === hangOn && !hung) { hung = true; return; } // never answers: the worker dies waiting
      const text = `Step ${step} result.`;
      if (request.stream) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        const chunk = (delta, finish = null) => `data: ${JSON.stringify({ id: "stub", object: "chat.completion.chunk", created: 0, model: request.model,
          choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
        res.end(chunk({ role: "assistant", content: text }) + chunk({}, "stop") + "data: [DONE]\n\n");
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "stub", object: "chat.completion", created: 0, model: request.model,
        choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
    });
  });
  return { server, calls };
}

function startWorker(dataDir, modelPort, id) {
  const worker = spawn(process.execPath, ["scripts/task-worker.mjs"], {
    cwd: root,
    env: { ...process.env, RICH_CHAT_DATA_DIR: dataDir, RICH_CHAT_LOG_DIR: "off", RICH_CHAT_WORKER_ID: id,
      RICH_CHAT_WORKER_MODEL_BASE_URL: `http://127.0.0.1:${modelPort}/v1`, RICH_CHAT_WORKER_LEASE_MS: "1500",
      RICH_CHAT_WORKER_HEARTBEAT_MS: "300", RICH_CHAT_WORKER_POLL_MS: "100" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  worker.stdout.on("data", data => { output += data; });
  worker.stderr.on("data", data => { output += data; });
  return { worker, output: () => output };
}

test("a worker killed during a run is resumed from the checkpoint by the next worker", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "rich-chat-worker-"));
  const { server, calls } = stubModel("2");
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const workers = [];
  after(() => {
    for (const { worker } of workers) worker.kill("SIGKILL");
    server.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  // Given a chat plan with a three-step job on a local model
  const store = createTaskStore(taskDatabasePath(dataDir));
  const jobs = createJobs(store);
  store.addItems(profile, "chat-kill", { objective: "Write a class newsletter", titles: ["Newsletter"] }, "user");
  const { job } = jobs.enqueue(profile, "chat-kill", { title: "Newsletter", steps: ["headlines", "articles", "proofread"], model: "gemma4:e2b-mlx" }, "user");
  const steps = () => store.db.prepare("SELECT step FROM job_steps WHERE job_id = ? ORDER BY step").all(job.id).map(row => row.step);

  // When the first worker commits step 1, starts step 2, and is killed
  const first = startWorker(dataDir, server.address().port, "worker-one");
  workers.push(first);
  await until(() => calls.get("2") === 1 && steps().length === 1, "step 1 committed and step 2 started");
  first.worker.kill("SIGKILL");
  await once(first.worker, "exit");
  assert.equal(jobs.get(profile, job.id).status, "running", "The dead worker still holds the lease");

  // Then a second worker reclaims the expired lease and resumes from the checkpoint
  const second = startWorker(dataDir, server.address().port, "worker-two");
  workers.push(second);
  await until(() => jobs.get(profile, job.id).status === "succeeded", "the job to finish", 30000);
  assert.deepEqual(steps(), [0, 1, 2]);
  assert.equal(calls.get("1"), 1, "Step 1 was generated once, before the kill");
  assert.equal(calls.get("2"), 2, "Step 2 was started by the killed worker and redone by the second");
  assert.equal(calls.get("3"), 1);
  const runs = store.db.prepare("SELECT worker_id, from_step, outcome FROM runs WHERE job_id = ? ORDER BY started_at, rowid").all(job.id);
  assert.deepEqual(runs.map(run => [run.worker_id, run.from_step, run.outcome]), [["worker-one", 0, "lease-expired"], ["worker-two", 1, "succeeded"]]);
  const view = jobs.forTask(profile, job.taskId, 40)[0];
  assert.ok(view.events.some(event => event.status === "requeued" && /resuming from step 2/.test(event.reason)));
  assert.equal(view.outcome.status, "succeeded");
  assert.equal(store.db.prepare("SELECT count(*) AS n FROM checkpoints WHERE note LIKE 'Job “Newsletter”: step % of 3 done'").get().n, 3);

  // And the worker stops cleanly when asked
  second.worker.kill("SIGTERM");
  const [code] = await once(second.worker, "exit");
  assert.equal(code, 0, second.output());
  assert.match(second.output(), /\[worker\] stopped/);
  store.close();
});

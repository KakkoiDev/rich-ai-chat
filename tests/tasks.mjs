// M9 persistent tasks and M10 background jobs: deterministic checks on the store, the jobs records and the worker loop,
// with an injected clock and an injected generator (no model, no network).
//   node --test tests/tasks.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { createActivity } from "../src/lib/activity.ts";
import { createJobs } from "../src/lib/tasks/jobs.ts";
import { planMarkdown } from "../src/lib/tasks/markdown.ts";
import { createTaskStore } from "../src/lib/tasks/store.ts";
import { createWorker } from "../src/lib/tasks/worker.ts";

const scratch = mkdtempSync(join(tmpdir(), "rich-chat-tasks-"));
after(() => rmSync(scratch, { recursive: true, force: true }));
let files = 0;
const databaseFile = () => join(scratch, `tasks-${++files}.sqlite`);
const alice = "profile-alice-0000000000";
const bob = "profile-bob-00000000000000";

/** Wait for a state, not for a time: poll the condition until it holds (or give up after a generous bound). */
async function until(condition, what) {
  for (let i = 0; i < 1000; i++) {
    if (condition()) return;
    await delay(5);
  }
  assert.fail(`Timed out waiting for ${what}`);
}
const refused = (run, status, pattern) => assert.throws(run, error => error.status === status && pattern.test(error.message));

function setup({ leaseMs = 1000 } = {}) {
  const clock = { now: 1_700_000_000_000 };
  const store = createTaskStore(databaseFile(), { clock: () => clock.now });
  const jobs = createJobs(store, { leaseMs });
  return { clock, store, jobs };
}

/** A generator that answers every step by name, or waits on a gate the test opens. */
function scriptedModel() {
  const calls = [];
  const gates = new Map();
  const generate = async ({ prompt, signal }) => {
    const step = /Step (\d+) of/.exec(prompt)?.[1];
    const title = /^Job: (.*)$/m.exec(prompt)?.[1];
    calls.push(`${title}#${step}`);
    const gate = gates.get(`${title}#${step}`);
    if (gate) {
      gates.delete(`${title}#${step}`);
      await Promise.race([gate.promise, new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }))]);
    }
    if (title?.includes("fails")) throw new Error("model refused");
    return `Result of ${title} step ${step}`;
  };
  return { calls, generate, hold: key => { const gate = Promise.withResolvers(); gates.set(key, gate); return gate; } };
}

function worker(jobs, model, workerId, options = {}) {
  return createWorker({ jobs, generate: model.generate, createActivity, workerId, heartbeatMs: 1e9, pollMs: 5, concurrency: 4, ...options });
}

// ---------------------------------------------------------------- M9

test("the two-step plan scenario: create, complete one step with evidence, reopen to find the rest", () => {
  const path = databaseFile();
  // A person creates a two-step plan for a chat (as the Tasks panel does).
  let store = createTaskStore(path);
  store.openTask(alice, "chat-plan", "Prepare the field-trip handout", "user");
  const { plan } = store.addItems(alice, "chat-plan", { titles: ["Draft the packing list", "Print 30 copies"], dependsOnPrevious: true }, "user");
  assert.deepEqual(plan.items.map(item => [item.title, item.status]), [["Draft the packing list", "pending"], ["Print 30 copies", "pending"]]);
  assert.deepEqual(plan.items[1].allowed, ["block", "cancel"], "The second step waits for the first");
  // The agent completes step one with evidence and records a checkpoint.
  const [first, second] = plan.items;
  const verified = store.recordVerification(alice, first.id, [{ kind: "artifact", ref: "packing-list-v1.md" }], first.version, "agent");
  assert.equal(verified.status, "done");
  store.recordCheckpoint(alice, plan.task.id, { itemId: first.id, note: "Packing list drafted; printing is next" }, "agent");
  store.close();

  // Reopening the chat (a new server process) finds the remaining step and the checkpoint.
  store = createTaskStore(path);
  const reopened = store.readPlan(alice, "chat-plan");
  assert.equal(reopened.task.objective, "Prepare the field-trip handout");
  assert.deepEqual(reopened.items.map(item => item.status), ["done", "pending"]);
  assert.equal(reopened.items[1].id, second.id);
  assert.ok(reopened.items[1].allowed.includes("start"), "The remaining step can start now");
  assert.deepEqual(reopened.items[0].evidence, [{ kind: "artifact", ref: "packing-list-v1.md" }]);
  assert.equal(reopened.checkpoints[0].note, "Packing list drafted; printing is next");
  const markdown = planMarkdown(reopened, store.changes(alice, reopened.task.id));
  assert.match(markdown, /^# Prepare the field-trip handout\n/);
  assert.match(markdown, /- \[x\] Draft the packing list — done\n {2}- evidence: artifact `packing-list-v1.md`/);
  assert.match(markdown, /- \[ \] Print 30 copies — to do \(after: Draft the packing list\)/);
  assert.match(markdown, /agent verify item \(in\\_progress → done\)/);
  assert.equal(markdown, planMarkdown(reopened, store.changes(alice, reopened.task.id)), "Export is byte-stable");
  store.close();
});

test("concurrent edits: a stale version is refused, and two processes adding todos lose none", async () => {
  const path = databaseFile();
  const panel = createTaskStore(path);
  const agent = createTaskStore(path);
  const { plan } = panel.addItems(alice, "chat-edit", { objective: "Plan a quiz", titles: ["Write ten questions"] }, "user");
  const item = plan.items[0];
  // Both read version 1; the person renames it first, then the agent's change based on version 1 is refused.
  panel.editItem(alice, item.id, "Write twelve questions", item.version, "user");
  refused(() => agent.changeItem(alice, item.id, "start", { expectedVersion: item.version }, "agent"), 409, /changed since it was read \(version 1, now 2\)/);
  refused(() => agent.recordVerification(alice, item.id, [{ kind: "test", ref: "quiz.test" }], item.version, "agent"), 409, /changed since it was read/);
  const fresh = agent.readPlan(alice, "chat-edit").items[0];
  assert.equal(fresh.title, "Write twelve questions");
  assert.equal(agent.changeItem(alice, item.id, "start", { expectedVersion: fresh.version }, "agent").status, "in_progress");

  // Two processes append to the same plan at the same time; BEGIN IMMEDIATE serializes them.
  const writer = join(scratch, "writer.mjs");
  writeFileSync(writer, [
    `import { createTaskStore } from ${JSON.stringify(pathToFileURL(join(import.meta.dirname, "../src/lib/tasks/store.ts")).href)};`,
    "const [path, name] = process.argv.slice(2);",
    "const store = createTaskStore(path);",
    `for (let i = 0; i < 20; i++) store.addItems(${JSON.stringify(alice)}, "chat-edit", { titles: [name + " " + i] }, "agent");`,
  ].join("\n"));
  const run = name => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [writer, path, name], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", data => { stderr += data; });
    child.on("exit", code => code === 0 ? resolve() : reject(new Error(stderr)));
  });
  await Promise.all([run("A"), run("B")]);
  const items = panel.readPlan(alice, "chat-edit").items;
  assert.equal(items.length, 41);
  assert.deepEqual(items.map(entry => entry.position), Array.from({ length: 41 }, (_, i) => i + 1), "Positions are unique and dense");
  panel.close();
  agent.close();
});

test("illegal transitions are refused with a reason and leave no trace", () => {
  const { store } = setup();
  const { plan } = store.addItems(alice, "chat-rules", { objective: "Bake bread", titles: ["Mix", "Bake"], dependsOnPrevious: true }, "user");
  const [mix, bake] = plan.items;
  const logged = () => store.changes(alice, plan.task.id).length;
  const before = logged();
  refused(() => store.recordVerification(alice, mix.id, [], undefined, "agent"), 409, /needs evidence/);
  refused(() => store.recordVerification(alice, mix.id, [{ kind: "vibes", ref: "looks fine" }], undefined, "agent"), 409, /kind must be/);
  refused(() => store.recordVerification(alice, mix.id, [{ kind: "receipt", ref: "op_does_not_exist" }], undefined, "agent"), 409, /does not exist/);
  refused(() => store.changeItem(alice, mix.id, "verify", { evidence: [{ kind: "test", ref: "t" }] }, "agent"), 409, /Cannot verify from pending \(allowed: start, block, cancel\)/);
  refused(() => store.changeItem(alice, bake.id, "start", {}, "agent"), 409, /waits for Mix/);
  refused(() => store.changeItem(alice, mix.id, "block", {}, "user"), 409, /reason is required/);
  refused(() => store.changeItem(alice, mix.id, "teleport", {}, "user"), 400, /Unknown event/);
  assert.equal(logged(), before, "Refused changes write nothing to the change log");
  assert.deepEqual(store.readPlan(alice, "chat-rules").items.map(item => item.status), ["pending", "pending"]);
  // A settled receipt is accepted as evidence; done can only be reopened.
  const receipt = store.receipts.once("op_bread_mixed", "mix", () => ({ ok: true }));
  assert.equal(receipt.replayed, false);
  assert.equal(store.recordVerification(alice, mix.id, [{ kind: "receipt", ref: "op_bread_mixed" }], undefined, "agent").status, "done");
  refused(() => store.changeItem(alice, mix.id, "start", {}, "agent"), 409, /Cannot start from done \(allowed: reopen\)/);
  // The change log refuses edits and deletions.
  assert.throws(() => store.db.exec("UPDATE changes SET actor = 'user'"), /append-only/);
  assert.throws(() => store.db.exec("DELETE FROM changes"), /append-only/);
});

test("cross-profile isolation: another browser profile cannot see or change a plan", () => {
  const { store, jobs } = setup();
  const { plan } = store.addItems(alice, "chat-shared-id", { objective: "Alice's plan", titles: ["Alice's step"] }, "user");
  const { job } = jobs.enqueue(alice, "chat-shared-id", { title: "Alice's job", steps: ["one"], model: "deepseek-flash" }, "user");
  const itemId = plan.items[0].id;
  assert.equal(store.readPlan(bob, "chat-shared-id"), null, "Same chat id, different profile: no plan");
  refused(() => store.planById(bob, plan.task.id), 404, /Task not found/);
  refused(() => store.changeItem(bob, itemId, "cancel", {}, "user"), 404, /Item not found/);
  refused(() => store.editItem(bob, itemId, "Bob was here", undefined, "user"), 404, /Item not found/);
  refused(() => store.recordVerification(bob, itemId, [{ kind: "test", ref: "x" }], undefined, "agent"), 404, /Item not found/);
  refused(() => store.recordCheckpoint(bob, plan.task.id, { note: "hi" }, "agent"), 404, /Task not found/);
  refused(() => store.changes(bob, plan.task.id), 404, /Task not found/);
  refused(() => jobs.get(bob, job.id), 404, /Job not found/);
  refused(() => jobs.cancel(bob, job.id, "user"), 404, /Job not found/);
  assert.deepEqual(jobs.forTask(bob, plan.task.id), []);
  // Bob's plan for the same chat id is his own.
  const bobs = store.addItems(bob, "chat-shared-id", { objective: "Bob's plan", titles: ["Bob's step"] }, "user").plan;
  assert.notEqual(bobs.task.id, plan.task.id);
  assert.deepEqual(store.readPlan(alice, "chat-shared-id").items.map(item => item.title), ["Alice's step"]);
  assert.deepEqual(store.readPlan(bob, "chat-shared-id").items.map(item => item.title), ["Bob's step"]);
});

test("an agent proposal delivered twice adds its todos once", () => {
  const { store } = setup();
  const key = store.operationKey("propose", alice, "chat-dup", "Tidy the classroom", ["Stack chairs", "Wipe tables"], false);
  const first = store.addItems(alice, "chat-dup", { objective: "Tidy the classroom", titles: ["Stack chairs", "Wipe tables"], key }, "agent");
  const second = store.addItems(alice, "chat-dup", { objective: "Tidy the classroom", titles: ["Stack chairs", "Wipe tables"], key }, "agent");
  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true);
  assert.equal(store.readPlan(alice, "chat-dup").items.length, 2);
});

// ---------------------------------------------------------------- M10

test("a reclaimed lease resumes from the last committed step", async () => {
  const { clock, store, jobs } = setup();
  store.addItems(alice, "chat-job", { objective: "Write a story", titles: ["Draft"] }, "user");
  const { job } = jobs.enqueue(alice, "chat-job", { title: "Story", steps: ["outline", "draft", "polish"], model: "gemma4:e2b-mlx" }, "agent");
  const model = scriptedModel();
  const gate = model.hold("Story#2");
  const first = worker(jobs, model, "worker-a");
  assert.equal(first.tick(), 1);
  await until(() => model.calls.includes("Story#2"), "step 2 to start");
  assert.equal(jobs.get(alice, job.id).nextStep, 1, "Step 1 is committed");
  // The first worker hangs (no heartbeat); its lease expires and a second worker takes over.
  clock.now += 1500;
  const secondModel = scriptedModel();
  const resumed = worker(jobs, secondModel, "worker-b");
  assert.equal(resumed.tick(), 1);
  await resumed.idle();
  assert.deepEqual(secondModel.calls, ["Story#2", "Story#3"], "Step 1 is not generated again");
  const finished = jobs.get(alice, job.id);
  assert.equal(finished.status, "succeeded");
  assert.equal(finished.nextStep, 3);
  const view = jobs.forTask(alice, finished.taskId, 30)[0];
  assert.equal(view.runs, 2);
  assert.ok(view.events.some(event => event.type === "job" && event.status === "requeued" && /resuming from step 2/.test(event.reason)));
  assert.ok(view.events.some(event => event.type === "job" && event.status === "running" && /Resumed from the checkpoint after step 1/.test(event.reason)));
  assert.ok(view.events.some(event => event.type === "core-recovery" && event.event.type === "resume"));
  assert.ok(view.events.some(event => event.type === "core-recovery" && event.event.type === "checkpoint"));
  // The hung worker wakes up: its late step-2 result is a duplicate delivery and is not committed again.
  gate.resolve();
  await first.idle();
  const steps = store.db.prepare("SELECT step, count(*) AS n FROM job_steps WHERE job_id = ? GROUP BY step").all(job.id);
  assert.deepEqual(steps.map(row => [row.step, row.n]), [[0, 1], [1, 1], [2, 1]]);
  const checkpoints = store.db.prepare("SELECT count(*) AS n FROM checkpoints WHERE note LIKE 'Job “Story”: step 2 of 3 done'").get();
  assert.equal(checkpoints.n, 1, "The receipt kept the step-2 checkpoint single");
  const runs = store.db.prepare("SELECT worker_id, outcome FROM runs WHERE job_id = ? ORDER BY started_at, rowid").all(job.id);
  assert.deepEqual(runs.map(run => [run.worker_id, run.outcome]), [["worker-a", "lease-expired"], ["worker-b", "succeeded"]]);
  assert.ok(jobs.forTask(alice, finished.taskId)[0].events.some(event => event.status === "checkpoint" && /not repeated/.test(event.reason ?? "")));
});

test("duplicate delivery: a step committed twice is recorded once, and a queued job is not queued twice", () => {
  const { store, jobs } = setup();
  store.addItems(alice, "chat-dup-job", { objective: "Summaries", titles: ["Summarise"] }, "user");
  const request = { title: "Summaries", steps: ["one", "two"], model: "deepseek-flash", key: "tool-call-7" };
  const queued = jobs.enqueue(alice, "chat-dup-job", request, "agent");
  const again = jobs.enqueue(alice, "chat-dup-job", request, "agent");
  assert.equal(again.replayed, true);
  assert.equal(again.job.id, queued.job.id);
  const claim = jobs.claimNext("worker-a");
  assert.equal(claim.job.id, queued.job.id);
  assert.equal(jobs.claimNext("worker-b"), null, "A leased job is not delivered to a second worker");
  assert.equal(jobs.commitStep(claim.run, 0, "first").replayed, false);
  assert.equal(jobs.commitStep(claim.run, 0, "first, delivered again").replayed, true);
  assert.equal(store.db.prepare("SELECT output FROM job_steps WHERE job_id = ? AND step = 0").get(claim.job.id).output, "first");
  assert.equal(store.db.prepare("SELECT count(*) AS n FROM checkpoints WHERE note LIKE '%step 1 of 2 done'").get().n, 1);
  const done = jobs.finish(claim.run, "succeed", "2 steps done");
  assert.equal(done.status, "succeeded");
  assert.equal(jobs.finish(claim.run, "succeed", "again"), null, "A finished run holds no lease");
  assert.equal(store.db.prepare("SELECT count(*) AS n FROM outcomes WHERE job_id = ?").get(claim.job.id).n, 1);
  // The outcome receipt can back a verification.
  const item = store.readPlan(alice, "chat-dup-job").items[0];
  assert.equal(store.recordVerification(alice, item.id, [{ kind: "receipt", ref: done.receiptKey }], undefined, "agent").status, "done");
});

test("cancellation: a queued job ends at once and a running one stops its generation", async () => {
  const { store, jobs } = setup({ leaseMs: 60000 });
  store.addItems(alice, "chat-cancel", { objective: "Cancel things", titles: ["Anything"] }, "user");
  const waiting = jobs.enqueue(alice, "chat-cancel", { title: "Never runs", steps: ["one"], model: "deepseek-flash" }, "user").job;
  assert.equal(jobs.cancel(alice, waiting.id, "user").status, "cancelled");
  refused(() => jobs.cancel(alice, waiting.id, "user"), 409, /already cancelled/);
  const running = jobs.enqueue(alice, "chat-cancel", { title: "Long", steps: ["one", "two"], model: "deepseek-flash" }, "user").job;
  const model = scriptedModel();
  model.hold("Long#1");
  const loop = worker(jobs, model, "worker-a", { heartbeatMs: 10 });
  assert.equal(loop.tick(), 1);
  await until(() => model.calls.includes("Long#1"), "the generation to start");
  const requested = jobs.cancel(alice, running.id, "user");
  assert.equal(requested.status, "running");
  assert.equal(requested.cancelRequested, true);
  await loop.idle();
  const cancelled = jobs.forTask(alice, running.taskId).find(view => view.id === running.id);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.outcome.summary, "Cancelled by the person");
  assert.equal(cancelled.nextStep, 0, "Nothing was committed after the cancel");
  assert.ok(cancelled.events.some(event => event.type === "attempt-end" && event.reason === "cancelled"));
  assert.equal(store.db.prepare("SELECT count(*) AS n FROM leases").get().n, 0);
  assert.equal(store.db.prepare("SELECT count(*) AS n FROM model_slots").get().n, 0);
});

test("blocked dependencies wait with a reason, run after success, and fail after failure", async () => {
  const { store, jobs } = setup();
  store.addItems(alice, "chat-deps", { objective: "Two jobs", titles: ["Both"] }, "user");
  const first = jobs.enqueue(alice, "chat-deps", { title: "Research", steps: ["find facts"], model: "deepseek-flash" }, "agent").job;
  const second = jobs.enqueue(alice, "chat-deps", { title: "Write up", steps: ["write"], model: "deepseek-flash", dependsOn: first.id }, "agent").job;
  const doomed = jobs.enqueue(alice, "chat-deps", { title: "This one fails", steps: ["try"], model: "deepseek-flash" }, "agent").job;
  const orphan = jobs.enqueue(alice, "chat-deps", { title: "Needs the failure", steps: ["x"], model: "deepseek-flash", dependsOn: doomed.id }, "agent").job;
  const model = scriptedModel();
  const gate = model.hold("Research#1");
  const loop = worker(jobs, model, "worker-a");
  loop.tick();
  await until(() => model.calls.includes("Research#1"), "research to start");
  const blocked = jobs.get(alice, second.id);
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.waitingReason, "Waits for “Research” (running)");
  gate.resolve();
  await until(() => jobs.get(alice, doomed.id).status === "failed" && jobs.get(alice, first.id).status === "succeeded", "the first jobs to end");
  await loop.idle();
  loop.tick();
  await loop.idle();
  assert.equal(jobs.get(alice, second.id).status, "succeeded");
  const failed = jobs.forTask(alice, orphan.taskId).find(view => view.id === orphan.id);
  assert.equal(failed.status, "failed");
  assert.equal(failed.outcome.summary, "Its dependency “This one fails” failed");
  assert.deepEqual(model.calls.filter(call => call.startsWith("Needs")), [], "A job whose dependency failed never runs");
  assert.ok(jobs.forTask(alice, second.taskId).find(view => view.id === second.id).events
    .some(event => event.status === "blocked" && event.reason === "Waits for “Research” (running)"));
});

test("waiting reasons are visible: one generation at a time on a local model, hosted jobs run beside it", async () => {
  const { store, jobs } = setup();
  store.addItems(alice, "chat-slots", { objective: "Many jobs", titles: ["All"] }, "user");
  const one = jobs.enqueue(alice, "chat-slots", { title: "Local one", steps: ["a"], model: "gemma4:e2b-mlx" }, "agent").job;
  const two = jobs.enqueue(alice, "chat-slots", { title: "Local two", steps: ["b"], model: "gemma4:e2b-mlx" }, "agent").job;
  const hosted = jobs.enqueue(alice, "chat-slots", { title: "Hosted", steps: ["c"], model: "deepseek-flash" }, "agent").job;
  const model = scriptedModel();
  const gate = model.hold("Local one#1");
  const loop = worker(jobs, model, "worker-a");
  assert.equal(loop.tick(), 2, "The hosted job runs beside the first local one");
  const parked = jobs.forTask(alice, one.taskId).find(view => view.id === two.id);
  assert.equal(parked.status, "waiting");
  assert.equal(parked.waitingReason, "Waiting for gemma4:e2b-mlx: one generation at a time on this local model");
  assert.ok(parked.events.some(event => event.type === "job" && event.status === "waiting"));
  await until(() => jobs.get(alice, hosted.id).status === "succeeded", "the hosted job");
  assert.equal(loop.tick(), 0, "Polling again changes nothing while the slot is held");
  assert.equal(jobs.forTask(alice, one.taskId).find(view => view.id === two.id).events.filter(event => event.status === "waiting").length, 1,
    "The same reason is recorded once");
  gate.resolve();
  await loop.idle();
  assert.equal(loop.tick(), 1);
  await loop.idle();
  assert.equal(jobs.get(alice, two.id).status, "succeeded");
  assert.equal(jobs.get(alice, two.id).waitingReason, null);
  const events = jobs.forTask(alice, one.taskId).find(view => view.id === one.id).events;
  assert.deepEqual(events.map(event => event.type), ["job", "request", "job", "attempt-start", "attempt-end", "core-recovery", "job", "job", "reply"],
    "Job progress uses the Activity event model");
});

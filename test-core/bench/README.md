# Benchmark runner

`bench.mjs` runs a benchmark plan against a frozen revision and keeps everything it learns. It has no dependencies
(Node.js 22.13+ built-ins only) and contains no cases or assertions: the host project supplies the tasks, the task body
and a gate. It was extracted from two runners that solved the same problems separately:

- Rich AI Chat's five-model matrix: ten perfect rounds in a row, then one regression round, on one frozen revision.
- Schness's engine-strength runs: thousands of independent games, frozen source hashes, checkpoints, a single-runner
  lock and resume.

```js
import { runBench, streakGate } from './test-core/bench/bench.mjs';

const tasks = [];
for (let round = 1; round <= 11; round++)
  for (const model of models) tasks.push({ id: `r${String(round).padStart(2, '0')}-${model}`, round, model });

const { state, exitCode, summary } = await runBench({
  dir: process.env.EVAL_DIR, revision: process.env.EVAL_REVISION, tasks,
  gate: streakGate({ required: 10, regression: 1 }),
  exclusive: task => task.model.startsWith('gemma4:') ? 'ollama' : undefined,  // one local generation at a time
  secrets: [process.env.MODEL_API_KEY, process.env.BRAVE_SEARCH_API_KEY],
  async run(task, { signal, taskDir }) {
    // Start the app, run the suites, write reports into taskDir, and return the verdict.
    return { ok: passed === expected, checks: { passed, expected }, suites };
  },
});
process.exitCode = exitCode;
```

## What a run keeps

| File | Contents |
| --- | --- |
| `manifest.json` | revision, plan hash, gate, frozen files with sha256, fingerprint, Node version, host `config` |
| `state.json` | state, PID, `updatedAt` (refreshed at least every 15 s while running), completed / total, active tasks with start times, the gate's summary, any failure |
| `tasks/<id>.json` | one checkpoint per finished task: the task, revision, fingerprint, start time, `seconds`, `ok` and the full result |
| `tasks/<id>/` | the task's own folder for reports, logs and screenshots |
| `run.lock` | the running process's PID; removed at the end, reclaimed only when that process no longer exists |

Failed tasks are kept exactly like passing ones. Nothing is ever deleted.

## Gates and states

| Gate | Tasks carry | Verdict |
| --- | --- | --- |
| `streakGate({ required, regression = 1 })` | `round` (1-based) | `stable-and-regression-passed` when every round passes; `needs-investigation` stops the run after the first round with a failed task. The summary sums `result.checks` (`{ passed, expected }`) when tasks report them. |
| `rateGate({ threshold, z = 1.96 })` | a result `outcome`: `win`, `draw` or `loss` | score = (wins + draws / 2) / games, with a Wilson interval. `above-threshold` when the lower bound reaches the threshold, `below-threshold` when the upper bound is under it, otherwise `inconclusive`. There is no early stopping; a failed task stops the run as `needs-investigation`. |
| `allGate()` (default) | — | `complete` when every task passes, otherwise `needs-investigation`. |

Other states: `interrupted` (SIGINT/SIGTERM; tasks in flight are aborted and not recorded), `runner-error` (the
runner itself failed), and `secret-leak` (a configured secret value appears in a file under the run folder; the summary
names the file and the secret's index, never its value).

Exit codes: 0 for `stable-and-regression-passed`, `complete` and `above-threshold`; 1 for `needs-investigation`,
`below-threshold` and `inconclusive`; 130 for `interrupted`; 2 for `runner-error` and `secret-leak`.

## Rules the runner enforces

- **One run per folder.** A new run refuses a folder that already holds one. A resume refuses a finished run, a changed
  revision, a changed plan, a changed gate, a changed frozen file (`freeze: { root, files }`) or a checkpoint from
  another run. When it refuses, it changes nothing.
- **Resume never repeats finished work.** Checkpointed tasks are skipped; tasks that were in flight run again.
- **Concurrency is bounded.** `concurrency` caps the tasks in flight. `exclusive(task)` returns a key, and at most one
  task per key runs at a time, for example one generation per local model.
- **Tasks get the abort signal.** Pass it to child processes and requests so an interruption stops them.

The host owns everything else: what a case asserts, which models or engines run, and how to start and stop the app.
Keep case counts honest in the host. Rich AI Chat, for example, compares each suite's case list with its expected count
before calling a task `ok`.

## The toolkit around the runner

The runner judges one run. These pieces make a long benchmark repeatable and hard to fool. All of them are dependency
free and have scenarios and tests.

| Piece | What it does |
| --- | --- |
| `seeded.mjs` | `seeded(case, round, subject)` gives `pick`, `pickDistinct`, `int` and `next`. The same key always gives the same choices, so a failure reproduces exactly; different keys vary the wording and data, so no case is one memorised sentence. |
| `freeze.mjs` | `freezeRevision({ repo, revision, into, copy, link })` writes one committed revision into its own folder with `git archive`, so uncommitted edits never leak in. Large folders such as `node_modules` are copied (APFS clones on macOS, instant). `FROZEN.json` names the revision. It refuses an existing folder or an unknown revision, and cleans up after a failure. |
| `launch.mjs` | `launchDetached({ folder, label, argv, cwd, env })` starts the run so it outlives whatever started it: a launchd job on macOS (it survives the launching app quitting) or a detached process elsewhere. `stopDetached(folder)` sends SIGTERM, which the runner records as `interrupted`. Put secrets in an env file read by the run (`node --env-file`), never in `env`, because launchd keeps `env` in a plist on disk. |
| `report.mjs` | `summarize(dir)` gives the state, checks, rounds and, per subject, cases passed, median and slowest seconds and every failure with its detail. A task's result may list `cases: [{ id, status, seconds, detail }]`; otherwise the task counts as one case. `waitForRun(dir)` resolves when the run is final, or `stale` when its process died while it still said running. |
| `cli.mjs` | One command line for all of the above (below). |

```sh
node test-core/bench/cli.mjs freeze --repo . --revision HEAD --into ../builds/$(git rev-parse HEAD) --copy node_modules
node test-core/bench/cli.mjs launch --folder reports/run-1 --label my.bench.run-1 --cwd ../builds/<sha> -- node --env-file=/path/.env bench/run.mjs reports/run-1
node test-core/bench/cli.mjs watch reports/run-1          # waits, prints the summary, exits with the run's exit code
node test-core/bench/cli.mjs report reports/run-1 --json  # at any time, also while it runs
node test-core/bench/cli.mjs stop reports/run-1
```

## The method

These rules came out of releasing Rich AI Chat against five models, three local and slow. Each one prevented a false
"stable" or saved a restart.

1. **Freeze the revision.** Benchmark a commit, frozen into its own folder with its own build, never the working tree.
   Work continues while the run goes on, and the result belongs to exactly one revision.
2. **Launch it so it survives.** A run takes hours; the editor, terminal or app that started it may quit. Launch it
   detached, check it is alive (`report`), and get told when it ends (`watch`).
3. **Run the deterministic checks first.** Browser, device and fault-injection tests that need no model run once on the
   frozen build before the model matrix. A model run must not be the first place a broken build shows up.
4. **Vary the inputs, keep them reproducible.** Generate synthetic prompts from a seed (`seeded`), check in the host
   that every generated prompt takes the path the case means to test, and save the prompt in the case's report.
5. **Assert outcomes, not text.** Click the buttons, read the output, reload, go offline, replay the exported file.
   "A code block was returned" proves nothing.
6. **Make the gate strict and boring.** For a release: ten perfect rounds in a row, then one more on the same frozen
   revision (`streakGate`). Failures, skips, changed expectations and mixed revisions all count against it. For strength
   comparisons, use `rateGate` and its interval, not a raw percentage.
7. **Keep every failure, with its evidence.** Failed reports are never deleted. Save what is needed to diagnose without
   rerunning: the synthetic prompt, the reply, the app's own record of what happened, and, on servers that only see
   synthetic input, the rejected drafts.
8. **Reproduce, fix the general behaviour, restart from round one.** A failure is first reproduced with the same seed,
   then fixed in the product (never with a response written for the benchmark), tested where it was found, and the
   streak restarts on the new revision. Before restarting, sweep the slowest or weakest subject across many seeds:
   failures that would have stopped round 6 surface in minutes instead of hours.
9. **Read the slow tail.** A dependency that fails "now and then" usually has a measurable tail. Measure it from the run's
   own logs before calling a failure bad luck, and fix the product (for example a hedged request) instead of restarting
   on the same code.
10. **Grow the benchmark with the product.** Each feature adds cases; the host checks the expected count against the
    suite's own case list, so a new case cannot be left out of the gate silently.
11. **Keep private data out.** Synthetic prompts only, fresh browser contexts, no personal history, and a secret scan of
    the whole run folder (`secrets`) before a run may pass.

Scenarios: [SCENARIOS.md](SCENARIOS.md). Tests: `npx vitest run tests/js/bench.test.js tests/js/bench-toolkit.test.js`,
and `python3 tools/scenarios.py check bench/SCENARIOS.md --tests tests/js/bench.test.js tests/js/bench-toolkit.test.js
--junit <vitest junit report>`.

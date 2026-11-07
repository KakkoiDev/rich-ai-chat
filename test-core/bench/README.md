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

Scenarios: [SCENARIOS.md](SCENARIOS.md). Tests: `npx vitest run tests/js/bench.test.js`, and
`python3 tools/scenarios.py check bench/SCENARIOS.md --tests tests/js/bench.test.js --junit <vitest junit report>`.

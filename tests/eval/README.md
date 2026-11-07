# Basic capability evaluation

Use the same prompts and assertions for each model. Point the runner at a Rich AI Chat server configured for the model under test. Use the same app revision, provider settings where possible, and a warmed model for timing comparisons. The model label in the report is supplied by the operator; it does not change the server configuration.

From the repository root, with Playwright resolvable by Node and its Chromium installed:

```sh
CHAT_URL=http://127.0.0.1:3212/ EVAL_MODEL=gpt-oss:20b \
  EVAL_REPORT=baseline-20b.json node tests/eval/run.cjs
```

For another model, start an instance with its own `MODEL_ID` and `MODEL_BASE_URL`, then change the URL, label, and report path in the command. Pass case IDs after the script to run a subset, for example `context calculator repair`.

- **Model:** context recall without search, calculator behavior, repair from a runtime diagnostic, native pie values and colors, bundled image, and a playable game with restart.
- **App:** repeated table-to-chart request with separate units, and the Slingshot starter. These can pass even if the model cannot generate a chart or game.
- **Live:** exactly one search for Tokyo weather and a citation to a returned source. A provider error or empty result is a skip. This checks tool use and citation wiring, not the accuracy or freshness of the forecast.

The newer tool checks can run independently:

```sh
CHAT_URL=http://127.0.0.1:3212/ EVAL_MODEL=gpt-oss:20b \
  node tests/eval/run.cjs local-clock named-zone-clock online-pictures online-videos uncertain-fact-search
```

- **App:** the local date follows the browser time zone. Pictures and videos must render real thumbnails and usable HTTPS links. These media checks hit the live provider, but direct prompts bypass the model, so they do not measure model capability.
- **Model:** the named-zone clock case requires a real tool call. The obscure factual question requires the model to decide to search without being told and the reply to cite a returned source.

Each case starts with fresh browser storage or an explicit message history. The runner prints a result and duration per case, returns a failing exit code if any case fails, and optionally writes JSON. A skipped search does not count as a pass. Runs are samples of model behavior; keep all results if repeating a run. The broader prompts in [scenarios.json](../scenarios.json) are for exploratory evaluation and are not automatically scored by this runner.

The [first full GPT-OSS 20B baseline](baselines/gpt-oss-20b.json) passed 6 of 9 checks: 3 of 6 model tasks, both app checks, and live search. Native pie, classroom image, and tic-tac-toe did not meet the browser assertions. A preliminary run also called search successfully but omitted a returned source link, so the passing live search result should not be read as guaranteed citation behavior.

To compare the requested Ollama MLX variants, run the suite once per model with the same app revision. Use `gemma4:12b-mlx`, `gemma4:e4b-mlx`, or `gemma4:e2b-mlx` for both the server's `MODEL_ID` and the runner's `EVAL_MODEL`. Give each run its own JSON report. Start with one server/model at a time to avoid model loading and memory contention affecting timeouts.

The game case measures generation with the app's tic-tac-toe rules recipe enabled. The model still writes the playable HTML and JavaScript. Keep the app revision fixed for comparisons; the original GPT-OSS baseline used a stricter pie palette assertion that rejected some correctly colored charts.

The [GPT-OSS 20B retest](baselines/gpt-oss-20b-retest.json) passed all nine checks with the local classroom rules, corrected pie assertion, and board-game recipe. Treat this as one passing run; model replies and live search results can vary.

To run the five-model stability matrix, build once, then run the matrix against that build. Use a fresh report directory and provide the configured Brave and DeepSeek keys via the environment. Keep the benchmark port separate from the live app.

```sh
RICH_CHAT_BUILD_DIR=.next-local/bench npm run build
RICH_CHAT_BUILD_DIR=.next-local/bench EVAL_REVISION="$(git rev-parse HEAD)" \
  EVAL_DIR=/path/to/new-report-directory node tests/eval/matrix.cjs
```

The matrix runs the basic, breadth and features suites serially for each model: 14 + 13 + 2 = 29 cases, so 145 checks per round across the five models. A skipped, failed, or missing case ends the streak after the current round finishes.

The features suite (`features/run-features.cjs`) grows with each milestone ([benchmark plan](../../docs/BENCHMARK-PLAN.md)). Its prompts come from `features/prompts.cjs`, seeded by round, model and case: the wording and data vary, and the same key always reproduces the same prompt, which is saved in the report. Preflight checks that every prompt stays outside the app's tested layouts, so the model's own code is what gets tested. `run-features.cjs --list` prints the case ids, and the matrix refuses to start if its expected count differs. The M1 cases build a varied app, use it, open it full screen, then download its source and replay the same actions on the file in an offline browser. One case does this after a revision and checks that the first version is unchanged.

The deterministic full-screen and export checks need no model: `CHAT_URL=http://127.0.0.1:<port>/ node tests/e2e/fullscreen-export.cjs` (Playwright via `NODE_PATH`). They cover the Fullscreen API on desktop, the full-window fallback on a phone (including Escape pressed inside the sandboxed app), and offline downloads of a plain app and of a LittleJS game. On a frozen build, ten perfect rounds across all models trigger one final regression round. After a fix, rebuild and use a fresh directory so prior failures remain available for comparison.

The matrix runs on test-core's pinned benchmark runner (`test-core/bench`; the pin is in `test-core/MANIFEST.json`, checked with `python3 test-core/adopt.py --verify test-core`). One task is one model in one round. The report directory holds:

- `manifest.json`: the revision, plan, frozen files with their hashes (the harness scripts, `package-lock.json`, the build's `BUILD_ID`) and the configuration
- `state.json`: the state, PID, active task and a running summary, refreshed while the run is alive
- `tasks/rNN-<model>.json`: each finished task's verdict, checks and duration
- `tasks/rNN-<model>/{basic,breadth,features}.json`: the suite reports with per-case durations
- `matrix.json`: a short final summary

Failed and interrupted reports are kept. `EVAL_RESUME=1` continues an interrupted run in the same directory without repeating finished tasks. It refuses if a frozen file, the plan or the revision changed. A run fails as `secret-leak` if a configured API key appears anywhere in its reports. `EVAL_REQUIRED` and `EVAL_REGRESSION` (default 10 and 1) shorten a run for parity and focused checks. Only the full 10 + 1 run counts toward a release, whatever its final state is called.

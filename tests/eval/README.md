# Basic capability evaluation

Use the same prompts and assertions for each model. Point the runner at a Rich AI Chat server configured for the model under test. Use the same app revision, provider settings where possible, and a warmed model for timing comparisons. The model label in the report is supplied by the operator; it does not change the server configuration.

From the repository root, with Playwright resolvable by Node and its Chromium installed:

```sh
CHAT_URL=http://127.0.0.1:3212/ EVAL_MODEL=gpt-oss:20b \
  EVAL_REPORT=baseline-20b.json node tests/eval/run.cjs
```

For another model, start an instance with its own `MODEL_ID` and `MODEL_BASE_URL`, then change the URL, label, and report path in the command. Pass case IDs after the script to run a subset, for example `context calculator repair`.

- **Model:** context recall without search, calculator behavior, repair from a runtime diagnostic, native pie values and colors, a line chart from numbers given in plain text, bundled image, and a playable game with restart.
- **App:** repeated table-to-chart request with separate units, the Slingshot starter, a map preview, and a weekly temperature chart backed by a local forecast fixture. These can pass even if the model cannot generate a chart or game.
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

The matrix runs the basic, breadth and features suites serially for each model: 17 + 13 + 4 = 34 cases, so 170 checks per round across the five models. A skipped, failed, or missing case ends the streak after the current round finishes.

The features suite (`features/run-features.cjs`) grows with each milestone ([benchmark plan](../../docs/BENCHMARK-PLAN.md)). Its prompts come from `features/prompts.cjs`, seeded by round, model and case: the wording and data vary, and the same key always reproduces the same prompt, which is saved in the report. Preflight checks that every prompt stays outside the app's tested layouts, so the model's own code is what gets tested. `run-features.cjs --list` prints the case ids, and the matrix refuses to start if its expected count differs. The M1 cases build a varied app, use it, open it full screen, then download its source and replay the same actions on the file in an offline browser. One case does this after a revision and checks that the first version is unchanged.

The deterministic full-screen and export checks need no model: `CHAT_URL=http://127.0.0.1:<port>/ node tests/e2e/fullscreen-export.cjs` (Playwright via `NODE_PATH`). They cover the Fullscreen API on desktop, the full-window fallback on a phone (including Escape pressed inside the sandboxed app), and offline downloads of a plain app and of a LittleJS game. On a frozen build, ten perfect rounds across all models trigger one final regression round. After a fix, rebuild and use a fresh directory so prior failures remain available for comparison.

The matrix runs on test-core's pinned benchmark runner (`test-core/bench`; the pin is in `test-core/MANIFEST.json`, checked with `python3 test-core/adopt.py --verify test-core`). One task is one model in one round. The report directory holds:

- `manifest.json`: the revision, plan, frozen files with their hashes (the harness scripts, `package-lock.json`, the build's `BUILD_ID`) and the configuration
- `state.json`: the state, PID, active task and a running summary, refreshed while the run is alive
- `tasks/rNN-<model>.json`: each finished task's verdict, checks and duration
- `tasks/rNN-<model>/{basic,breadth,features}.json`: the suite reports with per-case durations
- `matrix.json`: a short final summary

Failed and interrupted reports are kept. `EVAL_RESUME=1` continues an interrupted run in the same directory without repeating finished tasks. It refuses if a frozen file, the plan or the revision changed. A run fails as `secret-leak` if a configured API key appears anywhere in its reports. `EVAL_REQUIRED` and `EVAL_REGRESSION` (default 10 and 1) shorten a run for parity and focused checks. Only the full 10 + 1 run counts toward a release, whatever its final state is called.

The features runner saves each failing reply's Activity events (ids, timings, statuses and the app's own check messages) in the report. To read the drafts a model produced, start the benchmark server with `RICH_CHAT_DEBUG_CAPTURE=1` and a `RICH_CHAT_LOG_DIR`: rejected drafts are appended to `debug-drafts.jsonl` there. Use it only for synthetic benchmark runs, never on a server people use.

## Starting a release streak

One command does what the [benchmark plan](../../docs/BENCHMARK-PLAN.md) requires, using test-core's bench toolkit
(`test-core/bench`, [its method](../../test-core/bench/README.md)):

```sh
node tests/eval/release.mjs --revision HEAD --note "why this run"
node test-core/bench/cli.mjs watch "$(cat ~/Library/Application\ Support/Rich\ AI\ Chat\ Benchmarks/latest.txt)"
```

1. It refuses while another benchmark is still running.
2. It freezes the commit into `builds/<sha>`: committed files only, `node_modules` as clones, and a link to the
   Playwright folder (`RICH_CHAT_BENCH_MODULES`, default `<root>/bench-modules`).
3. It builds there.
4. It runs the deterministic checks on that build: Activity against a stub model, installable apps on a throwaway
   Caddy export origin (`tests/e2e/export-install.cjs`), the chat as an offline-capable app
   (`tests/e2e/chat-pwa.cjs`), then full screen and export. The two app checks need full Chromium for Playwright's
   version (`npx playwright install chromium`) and a Caddy binary (`RICH_CHAT_CADDY`, `caddy` on the PATH, or the
   host's copy beside tailscaled).
5. It launches the matrix as a launchd job that survives this process and the desktop app.

The job gets settings only. Secrets stay in the env file (`RICH_CHAT_ENV_FILE`), which the run reads itself. Rejected
drafts are captured for diagnosis, because benchmark prompts are synthetic. `--no-launch` stops after the checks.

`node test-core/bench/cli.mjs report <folder>` shows each model's cases, median and slowest times, and failures with
their details at any point. `stop <folder>` ends a run as interrupted.

### Paid APIs: replay by default

The matrix uses test-core's loopback response proxy for Brave (web, image and video)
and DeepSeek Flash. Ollama models still run live locally. The release launcher
requires a cassette (`EVAL_PAID_CASSETTE`, default `<benchmark root>/paid-api.jsonl`)
and does not load the live app's credentials. A cassette miss fails the matrix
task; there is no live fallback. The manifest pins the cassette digest, and
`matrix.json` reports hits, misses, outbound attempts and failures.

A full cassette is not bundled. To capture responses for synthetic benchmark
requests, run `matrix.cjs` separately against a dedicated build and report directory
with `EVAL_PAID_MODE=record EVAL_REQUIRED=1 EVAL_REGRESSION=0`, an explicit
`EVAL_PAID_CASSETTE`, a positive `EVAL_PAID_MAX_REQUESTS`, and separate
`EVAL_BRAVE_SEARCH_API_KEY` / `EVAL_DEEPSEEK_API_KEY` credentials. If using an env
file, keep it outside the repository. Recording checks the keys against the live
configuration (override its location with `RICH_CHAT_ENV_FILE`) and inherited keys.
When the owner explicitly permits shared keys, set `EVAL_ALLOW_SHARED_PAID_KEYS=1`
for that capped recording run only. Replay still makes zero paid calls.
Recording is fixture preparation, not a release result.
Review captured responses before sharing. Exact matching means new prompts, changed
tool outputs, or new queries from local models may need new recordings. Replay
tests the app's handling of DeepSeek's recorded output, not current hosted model
quality or latency; live provider checks are separate and explicitly budgeted.

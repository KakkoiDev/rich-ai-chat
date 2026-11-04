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

Each case starts with fresh browser storage or an explicit message history. The runner prints a result and duration per case, returns a failing exit code if any case fails, and optionally writes JSON. A skipped search does not count as a pass. Runs are samples of model behavior; keep all results if repeating a run. The broader prompts in [scenarios.json](../scenarios.json) are for exploratory evaluation and are not automatically scored by this runner.

The [first full GPT-OSS 20B baseline](baselines/gpt-oss-20b.json) passed 6 of 9 checks: 3 of 6 model tasks, both app checks, and live search. Native pie, classroom image, and tic-tac-toe did not meet the browser assertions. A preliminary run also called search successfully but omitted a returned source link, so the passing live search result should not be read as guaranteed citation behavior.

To compare the requested Ollama MLX variants, run the suite once per model with the same app revision. Use `gemma4:12b-mlx`, `gemma4:e4b-mlx`, or `gemma4:e2b-mlx` for both the server's `MODEL_ID` and the runner's `EVAL_MODEL`. Give each run its own JSON report. Start with one server/model at a time to avoid model loading and memory contention affecting timeouts.

The game case measures generation with the app's tic-tac-toe rules recipe enabled. The model still writes the playable HTML and JavaScript. Keep the app revision fixed for comparisons; the original GPT-OSS baseline used a stricter pie palette assertion that rejected some correctly colored charts.

The [GPT-OSS 20B retest](baselines/gpt-oss-20b-retest.json) passed all nine checks with the local classroom rules, corrected pie assertion, and board-game recipe. Treat this as one passing run; model replies and live search results can vary.

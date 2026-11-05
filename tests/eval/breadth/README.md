# Rich AI Chat breadth benchmark pilot

PLH is the closest reference. Its nine scenarios span bug fixes, documentation, features, refactoring, and browser behavior. Its independent scenario checker and regression command judge the resulting files separately from the agent's own verification. The historical October 17 batch reported 2/9 resolved for Gemma E4B both with the harness and bare. The harness verified and committed 3/9 versus 0/9 bare, which is a different measure. That small archival sample is not a ranking or a current-build comparison.

Public benchmark patterns to borrow:

- [SWE-bench Verified](https://openai.com/index/introducing-swe-bench-verified/): use a known-broken starting state, test the fix and independently protect behaviors that worked before.
- [WebArena](https://github.com/web-arena-x/webarena): verify completed tasks by inspecting browser or application state instead of trusting the assistant's completion claim.
- [BFCL](https://gorilla.cs.berkeley.edu/leaderboard): test required tool calls, correct arguments, and cases where the model should make no call.
- [τ-bench](https://arxiv.org/abs/2406.12045): report repeated success separately from average success. Rich AI Chat's existing ten-consecutive-perfect rule stays on the small app reliability suite.

## Pilot and planned coverage

| Family | Pilot | Follow-on cases |
| --- | --- | --- |
| App composition | Expense tracker with add, validation, removal and a running total | Study timer and session log; spreadsheet formulas with CSV round trip; mobile forms |
| Game mechanics | Novel turn-based token game with illegal-move handling, win and reset | Collision, keyboard focus, scoring, pause, resize, restart; variations across game genres |
| Extend familiar functionality | Calculator with Undo that preserves a pending operation; standard starter must not swallow the added requirement | Extend a specific supplied starter; change constraints on turn two; keep old controls working |
| Repair | Browser reports a broken Add action; revision must restore it and preserve Reset | Syntax vs. runtime vs. logic failures; failed repair preserves original; one bounded retry |
| Tools and instruction boundaries | Extract data from a quote without executing the quoted search instruction | Required search, valid arguments, no unnecessary calls, provider failure, injected snippets, repeated calls |
| Structured UI, data and languages | Existing core-suite pie, chart and image checks | Chart conversion with mixed units, missing values, tabs and form actions, Japanese follow-up, ambiguity and clarification |
| Multi-turn state | Existing context and repair checks | Conflicting corrections, long history, state retained vs. intentionally reset, cancellation |

The pilot uses five fixed prompts. It is a diagnostic set, not a statistically representative or genuinely hidden set. The adaptation case checks the resulting feature, not whether a specific starter was selected. Add distinct held-out tasks before tuning, including different mechanics and data rather than only paraphrases. Keep model-only, recipe-assisted and built-in cases labeled separately. Compare support modes on the same inputs where possible. Report per-family success, elapsed time, retries and failures. Do not fold this score into the existing nine-case reliability gate.

The Playwright checks are independent of the model. They assert visible controls, values and actions; the model is given the requested UI contract but not the click sequence or expected intermediate state. The repair case verifies fail-before/fix-after and preservation of reset. Live search should remain a separate integration check; use fixtures to compare tool decisions without changing search results.

## Run

With the target Rich AI Chat instance running and Playwright/Chromium available:

```sh
CHAT_URL=http://127.0.0.1:3229/ EVAL_MODEL=gpt-oss:20b \
  EVAL_REVISION=ec31eb0 EVAL_REPORT=./breadth-report.json node run-breadth.cjs
```

The runner returns 1 for a failed case and 2 for an infrastructure error. Each case gets a fresh browser page and records wall-clock time.

## Expanded comparison

The expanded suite retains the five pilot cases and adds seven new cases:

- **Build:** decimal and negative unit conversion; a sequence puzzle with an incorrect-input reset.
- **Adapt:** extend the shipped calculator through the real revision interface, then verify old arithmetic and the new operation together.
- **Structured UI:** switch native tabs in the browser; aggregate repeated rows into a native table.
- **Multi-turn:** update a fictional appointment, preserve the location, and answer in Japanese.
- **Tool restraint:** ask for missing route details before attempting a lookup.

The seven additions were run without adapting the app or its prompts to these cases. The five pilot cases were already seen, so report them separately when interpreting generalization. All fixtures are synthetic. The starter adaptation is model work on top of a known base; the other build cases require generated artifacts. Browser and protocol assertions score the result without a model judge. Both providers use the same app revision and checks, with the app's existing provider-specific reasoning settings. Hosted versus local timings measure end-to-end experience, not comparable hardware throughput. One run per model is a reference comparison, not a stability claim.

The expanded runs are in `gpt-oss-expanded.json` and `deepseek-expanded.json`. The same four cases were rerun on both models after fixing response parsing and aligning assertions with the prompts. The `*-assertion-retest.json` files retain those results. Regenerate the comparison with `node compare.cjs`; it marks every replaced observation. The original pilot remains separate.

This suite covers restraint (when not to search). The original reliability suite covers live search. A future breadth slice should exercise required calls, argument validation, provider failures and hostile returned snippets with a controlled provider fixture.

# Rich AI Chat — expanded benchmark plan

The benchmark grows with every feature. The existing suites stay unchanged:

- `tests/eval/run.cjs`: 14 basic cases
- `tests/eval/breadth/run-breadth.cjs`: 13 breadth cases

A new `features` suite adds model-driven cases milestone by milestone. A separate deterministic **device suite** covers platform behaviour that doesn't depend on the model.

## 1. Verified baseline

| Item | Value |
| --- | --- |
| Revision | `b490e06` (`b490e062e2fd…`) |
| Report | `~/Library/Application Support/Rich AI Chat Benchmarks/reports/b490e06.oVGouR`, state `stable-and-regression-passed` |
| Result | 10 perfect rounds plus 1 regression round, each 135/135; **1,485/1,485** in total |
| Per model | 297/297 for each of DeepSeek Flash, GPT-OSS 20B, Gemma 4 12B, E4B and E2B |
| Wall-clock | About 83 minutes for 11 rounds (about 7.5 minutes per round) |
| Per-case durations, median / max | DeepSeek 2.0 s / 12.9 s · GPT-OSS 4.0 s / 28.4 s · 12B 2.3 s / 23.3 s · E4B 1.5 s / 9.1 s · E2B 1.4 s / 5.6 s |
| Latent issue | 6 gpt-oss `AI_ToolChoiceViolationError` entries in `error.log` (a tool call while tool choice was `none`), all recovered |
| Failed reports kept | 16 `needs-investigation` directories plus 3 incomplete ones, all retained |

Many breadth cases finish in under 1 s because the host's tested layouts and binders handle fully specified requests. That's by design. It also means those cases mostly measure the host. New model-driven cases must use prompts that fall **outside** the tested-layout contracts, so the model's own output is what gets checked.

No new cases have been run yet. Results per model for the expanded matrix will be added here as each milestone's streak runs.

### Runner moved to test-core (2026-11-07)

- `tests/eval/matrix.cjs` now runs on test-core's shared runner (`test-core/bench/bench.mjs`), pinned at test-core `13f517d` through the adopt kit. The cases, environment variables and pass criteria are unchanged.
- **Parity:** one round on the frozen `b490e06` build, with only the harness changed. Report: `reports/b490e06-bench-parity.202611070313`.
  - Result: **135/135**, every model 27/27.
  - Per-model median / max case durations: DeepSeek 1.7 s / 4.9 s, GPT-OSS 3.7 s / 27.8 s, 12B 2.0 s / 20.9 s, E4B 1.2 s / 5.0 s, E2B 1.0 s / 3.5 s, in line with the baseline.
  - The app quit during the run. The runner recorded `interrupted` with DeepSeek's task checkpointed, and `EVAL_RESUME=1` finished the other four models without repeating it.
  - The known gpt-oss tool-choice violation appeared once and was recovered.
  - The run is recorded as `stable-and-regression-passed` because it was configured as 1 round with no regression round. It is a parity check, not a release streak.

### M1 trial round (2026-11-07, uncommitted candidate)

The M1 candidate added full screen, source download and the `features` suite with its first two cases. One trial round (report `reports/m1-trial.202611071827`) passed **145/145**: every model scored 29/29 with an empty error log.

| Model | Checks | `export-novel-app` | `export-after-revision` | Whole task |
| --- | --- | --- | --- | --- |
| DeepSeek Flash | 29/29 | 4.0 s | 6.0 s | 68 s |
| GPT-OSS 20B | 29/29 | 14.3 s | 30.8 s | 189 s |
| Gemma 4 12B | 29/29 | 17.4 s | 33.4 s | 159 s |
| Gemma 4 E4B | 29/29 | 5.9 s | 9.6 s | 66 s |
| Gemma 4 E2B | 29/29 | 2.3 s | 5.3 s | 42 s |

This is a trial on an unfrozen working tree. It doesn't count toward the gate. The release streak (ten rounds plus one regression round at 145/145, so 1,595 checks) needs a committed, frozen revision.

### M1 release streak at `2fd4b40` (2026-11-07): stopped in round 2

Report `reports/2fd4b40.MyyZob`, state `needs-investigation`, 289/290.

- Round 1 was perfect: 145/145.
- In round 2, Gemma 4 E2B failed `export-after-revision`. It was asked to add a "Minus 1" button and labelled it "-1"; the behaviour was correct. Both attempts were rejected by the label check.
- Every other model passed every case in both rounds.

**Reproduce.** The same seeded prompt failed 6 out of 6 times. Sweeping E2B over the features prompts for rounds 1–20 found more failures the streak would have hit later.

**Fixes, all general, all in the M2 candidate:**

1. **Relabel a new button.** A revision that adds exactly one new button while exactly one requested label is missing gets that button relabelled. Its behaviour is kept, and anything ambiguous is still rejected (`relabelNewButton`).
2. **Script requested separately.** When the smallest model writes markup but stops before the script (ending on a stray `</script>`), the host closes the markup and asks for the script alone (`closeMarkup`).
3. **Unclosed buttons.** A button left unclosed (`Reset all</br><script>`) is closed before its label is checked, but only when that makes the draft pass (`closeButtons`).
4. **Stricter label check.** A requested label written as a quoted string counted as a button even when it was only an id. Now a quoted label counts only when the script creates buttons, and a button's `aria-label` counts as its name.
5. **Output rule for the smallest model.** Its output holds only the current value, never a message, at build time and on revision.

**Result:** E2B passes 80 out of 80 features cases over two sweeps of rounds 1–20. Each fix has preflight tests built from the real failing drafts.

**Diagnosis tools that came out of this** (both part of M2):
- The features suite now saves each failing reply's Activity in the report.
- `RICH_CHAT_DEBUG_CAPTURE=1` saves rejected drafts beside the server log. It is for synthetic benchmark runs only, never for a server people use.

## 2. Rules (unchanged, restated)

- **Stable** means ten consecutive perfect rounds on the expanded matrix, then one full regression round on the same frozen revision. Failures, skips, changed expectations and mixed revisions all reset the streak.
- On a failure:
  1. Keep the report and its per-case timings.
  2. Reproduce with a synthetic input.
  3. Fix the general prompt, tool or runtime behaviour, never a benchmark-specific response.
  4. Add a test for the failing behaviour.
  5. Restart from round 1 on the new revision.
- Use a fresh `EVAL_DIR` per attempt; the harness refuses to reuse one.
- Check `latest.txt`, the recorded `pid` and whether the logs are advancing before launching anything. Never run a competing matrix against the same Ollama instance.
- Synthetic data only. The harness uses fresh Playwright contexts, never a personal browser profile, and never imports chat history. Reports live outside the repository.

## 3. Harness changes (land with M1)

1. **Third suite.** In `tests/eval/matrix.cjs`, add `['features', path.join(__dirname, 'features/run-features.cjs'), N]` to `suites`.
   - `run-features.cjs --list` prints its case IDs, and `matrix.cjs` asserts that N equals that count. Adding a case can then never be silently left out of the expected total.
   - Everything else, including the perfect check, already derives from `suites`.
2. **Same runner contract** as the breadth suite:
   - inputs: `CHAT_URL`, `EVAL_MODEL`, `EVAL_REVISION`, `EVAL_ROUND`, `EVAL_REPORT`
   - output: `{model, appRevision, startedAt, cases:[{id, category, status, seconds, …}]}`
   - exit code non-zero on any failure
3. **Varied synthetic prompts.** `tests/eval/features/prompts.cjs` exports seeded generators keyed by `(EVAL_ROUND, model, caseId)`. They draw app themes, labels, item names, numbers and languages (EN/JA) from synthetic word banks. Every generated prompt is written into the case report, so a failure can be reproduced exactly. Generators are checked to stay outside the tested-layout matchers (`basicKeypadSpec`, `basicExpenseSpec`, `basicTakeAwaySpec`, `basicRecipe`, the starters): preflight runs every generator for rounds 1–20 against those matchers.
4. **Per-case evidence**, synthetic only:
   - always: `prompt`, `seconds`, `status`, and phase timings (`generateSeconds`, `interactSeconds`, `exportSeconds`)
   - on failure: `observed` (as in breadth), `response` (up to 35 KB), and a PNG of the preview frame
   - from M2 on: `activity`, the redacted event list
5. **Secret scan.** Preflight scans the new report directory for the literal values of `MODEL_API_KEY`, `DEEPSEEK_API_KEY` and `BRAVE_SEARCH_API_KEY` and for tailnet hostnames, and fails if any appear.
6. **Device suite.** `tests/device/run-device.cjs` is deterministic, runs no model, and uses test-core recipes. It runs once per candidate before the matrix and must pass, but it isn't part of the five-model count.
   - It runs Chromium, plus Playwright WebKit where useful. Playwright WebKit is **not** iOS Safari, so iPhone behaviour stays on the manual checklist.
   - A manual device checklist, `docs/device-checklist.md` (created in M1), is filled in per release candidate. It records each device, OS and browser and the result.

## 4. Case catalog by milestone

Each case says what it observes. "Model" cases run in the five-model matrix every round. "Device" cases run once per candidate.

### M1 — Full-window apps and source export

| ID | Type | Synthetic input (varies per round) | Observable assertions |
| --- | --- | --- | --- |
| `export-novel-app` | Model | Build a small app outside the tested layouts, for example a tally board with 3–5 named counters drawn from a word bank, per-counter +1 buttons, "Reset all", and the total in one `<output>`. | In chat: a click sequence gives the expected per-counter values and total. **Full window:** after entering and exiting, the values are unchanged and focus returns to the trigger. **Export:** the downloaded file, served from loopback with the context offline, gives the same results for the same sequence, with no console errors or CSP violations. The reply isn't a known starter. |
| `export-after-revision` | Model | Build a varied app, then use the card's "What should change?" box to request one more control (label and effect vary). | v2 has the new behaviour and keeps the old behaviour. v1 is still in the thread and works unchanged. Both exports run offline with their own behaviour. |
| `fullscreen-native` | Device | The tested calculator starter, Chromium at 1280×800. | `document.fullscreenElement` is the wrapper. Escape, then Exit, restores the layout. The calculator state is preserved. |
| `fullscreen-overlay` | Device | The same starter at 390×844 with touch and `fullscreenEnabled` stubbed to false. | The overlay covers the viewport and the body doesn't scroll. Exit is visible, at least 44 px and reachable by Tab. Escape relayed from inside the frame exits. Focus is restored. |
| `export-engine-inline` | Device | The slingshot starter. | The exported file runs offline with LittleJS inlined and its licence notice present. |

After M1, a matrix round has (14 + 13 + 2) × 5 = **145 checks**, and the stable gate is **1,595/1,595**.

### M2 — Reply Activity

| ID | Type | Input | Assertions |
| --- | --- | --- | --- |
| `activity-single-search` | Model | A varied explicit web search request ("Look up the year … opened, and cite your source"). | Exactly **one** `web_search` ran, by the model or, when the model answered from memory, by the app as the person asked. The panel reads "Activity · 1 search · …". If the search succeeded ("N sources from M sites"), the reply cites a returned link. If the search provider was unreachable, the reply carries the app's "Search unavailable" notice and no link at all, and the report notes the outage. The owner chose this on 2026-11-07 so that a provider outage tests honesty instead of stopping the gate. Real results are still guarded: the basic suite's live-search cases need returned sources every round. |
| `activity-matches-tools` | Model | A varied simple explanation. | Activity reports exactly what ran. Its tool records equal the tool results in the stream, every start has an end, and the panel reads "no tools" only when none ran. Whether a model should search for a simple explanation is a model-policy question, covered by the basic `context` case. |
| (in `export-novel-app`) | Model | The varied tally app. | Activity says the app was "Built from the model's code", so the model's own code is what gets tested, not a tested layout or starter. |
| `activity-retry-no-duplicate` | Device | Stalled stream injected after a successful search (stubbed provider). | Activity shows the retry and its reason, and only **one** search execution. The reply is synthesized from the captured sources. |
| `activity-persist-delete` | Device | A stubbed reply. | The panel survives reload. Deleting the thread removes its activity from IndexedDB. |
| `capture-replay` | Device | `EVAL_CAPTURE=1` on a synthetic case. | The capture file has the prompt, settled reply and redacted activity, and replays without loading personal history. |

After M2: 31 cases per model (14 + 13 + 4), **155 checks per round**, so the stable gate is **1,705/1,705**. The M2 deterministic checks are `tests/e2e/activity.cjs`, 7 checks against a stub model.

### M3 — OpenUI reachability and actions

| ID | Type | Input | Assertions |
| --- | --- | --- | --- |
| `form-submit-roundtrip` | Model | A varied form request ("collect X, Y, Z; when I submit, plan …"). | The first reply contains the form and no pre-written result. Filling and submitting sends one user turn. The next reply uses exactly the submitted values. Submitting twice is prevented. |
| `editable-table-save` | Model | Varied table data to edit. | After an edit and "Save Changes", the next reply reflects the edited cell. |
| `native-layout-choice` | Model | A varied request for an accordion, steps or tabs. | A native component is used (no `HtmlArtifact`), and it can be operated with the keyboard at 390 px. |
| `gallery-coverage` | Device | The `/gallery` route. | All 82 components render, and every interactive control has an e2e step (`e2e_coverage.py`). |

After M3: 35 cases per model, **175 checks per round**.

#### Laya slice gate measurement (2026-11-08)

Laya chooses one component slice per request for small Gemma models (roadmap M3). It was measured on synthetic requests through the real sidecar, without a chat model. Reproduce with `node tests/eval/laya-slices.mjs`; it needs PLH's installed Laya runtime.

- **Model:** laya-mlx 0.4.0, multilingual model at `f2b4faf`, pi-local-harness `31866da`.
- **Question:** "Which kind of reply does the request need?", over descriptive options (`explanation_in_words`, `current_facts_from_the_web`, `chart_or_graph`, `table`, `form_to_fill_in`, `tabs_accordion_steps_or_cards`, `photos_or_videos`, `interactive_app_or_game`). The request is the state, as `{message}`.
- **Threshold:** `min_confidence` 0.99.
- **How the wording was chosen:** on `tests/eval/laya-slices.json` (176 requests, 22 per slice, 96 English and 80 Japanese). On the questions above 0.95 confidence, it was right on:
  - 70 of 78 with bare slice names
  - 109 of 118 with the chosen descriptive options

  Asking eight yes/no questions instead of one choice did worse. The wording and threshold were then frozen. A held-out set, `tests/eval/laya-slices-heldout.json` (80 requests, 10 per slice, half Japanese), was written afterwards and measured once.

| Set | Requests | Answered | Correct / answered | Abstained |
|---|---:|---:|---:|---:|
| Development | 176 | 90 | 88 (97.8%) | 86 (48.9%) |
| Held-out | 80 | 40 | 38 (95.0%) | 40 (50.0%) |
| Both | 256 | 130 | 126 (96.9%) | 126 (49.2%) |

Per slice, answered correctly out of answered (abstained in brackets):

| Slice | Development | Held-out |
|---|---|---|
| text | 12/12 (10) | 4/4 (6) |
| sources | 8/8 (14) | 2/2 (8) |
| chart | 19/19 (3) | 8/8 (2) |
| table | 4/4 (18) | 2/2 (8) |
| form | 14/14 (8) | 8/8 (2) |
| layout | 4/6 (16) | 2/4 (6) |
| media | 12/12 (10) | 6/6 (4) |
| app | 15/15 (7) | 6/6 (4) |

- **All four wrong answers were `layout` requests.** Two became `app` and two became `text`. Laya rarely answers for `table`, `sources` and `layout`.
- **Time:** a round trip through the sidecar takes a median of 5 ms (95th percentile 7 ms) once the model is loaded.
- **Decision:** the held-out rate is exactly the owner's 95% bar, so the gate is on by default, with `RICH_CHAT_LAYA_GATE=0` to turn it off. 40 answered requests is a small sample (a 95% interval of roughly 83–99%), and sliced prompts have not been through a model streak.

Prompt size per slice. Tokens are counted with Laya's tokenizer, which is mmBERT's Gemma tokenizer and close to what Gemma 4 sees:

| Prompt | Characters | Tokens | Share of full |
|---|---:|---:|---:|
| Full (today's rich path) | 39,891 | 10,354 | 100% |
| Concise Markdown (`text`, `sources`) | 758 | 160 | 2% |
| chart | 10,309 | 2,597 | 25% |
| table | 9,312 | 2,403 | 23% |
| form | 16,285 | 4,065 | 39% |
| layout | 20,526 | 5,096 | 49% |
| media | 7,859 | 1,929 | 19% |
| app | 8,472 | 2,032 | 20% |

Every sliced prompt carries the same base: the syntax rules, the classroom rules, and Stack, Card, CardHeader, TextContent, MarkDownRenderer and Callout. That base alone is 1,715 tokens.

**Model cases for the M3 streak:**
- Run the existing chart, table, form and app cases on the small Gemma models with the gate on and off, and compare.
- `gate-layout-request`: a varied tabs, accordion or steps request. Whatever Laya answers, the reply must use a native layout component or plain text, never `HtmlArtifact`.
- `gate-unavailable`: the same cases with the sidecar absent (`RICH_CHAT_PLH_DIR` pointing nowhere). The results must match the gate-off run.

### M4 — Kakkoi theme

| ID | Type | Assertions |
| --- | --- | --- |
| `themed-app-contrast` | Model | A varied generated app with the host-injected inline theme. Every visible control and the result meet 4.5:1 text contrast in light and dark. |
| `theme-token-pin` | Device | The chat and an exported app reference the pinned token hash, and no copied theme definitions exist in the repository. |

After M4: 36 cases per model, **180 checks per round**.

### M5 — Saved projects

| ID | Type | Assertions |
| --- | --- | --- |
| `project-reopen-revise` | Model | Save v1, reload, reopen it into a new thread and request a varied change. v2 works, and v1 is unchanged in the store. |

After M5: 37 cases per model, **185 checks per round**.

### M6 — Installable exported apps

| ID | Type | Assertions |
| --- | --- | --- |
| `pwa-export-novel-app` | Model | The varied model-built app is exported as a PWA on the export origin. CDP `Page.getInstallabilityErrors` returns nothing. After the service worker is installed, an offline reload works and the interaction check passes. |
| `pwa-origin-isolation` | Device | The export origin can't read the chat origin's storage. Manifest `id` and scope are distinct per app. |

After M6: 38 cases per model, **190 checks per round**.

### M7–M8 — Chat PWA and Capacitor

These are deterministic and run on devices; model behaviour is not under test.

- `chat-offline-shell`: the shell loads offline and shows the offline state.
- `host-unreachable`: the API is blocked, the unreachable state appears, and retry recovers.
- `reconnect-midstream`: an interrupted reply is labelled, and the next turn works.
- CORS and token checks for native origins.

Real-device checks for install, streaming, upload, dictation and the Tailscale-off state go on the manual checklist.

### M9–M10 — Tasks and background jobs

| ID | Type | Assertions |
| --- | --- | --- |
| `task-plan-two-step` | Model | A varied objective. The agent creates a two-item plan, which is visible in the panel. It completes item 1 with evidence. After a reload, item 2 and the checkpoint remain. |
| `task-verify-needs-evidence` | Model | Asked to mark an item verified without a test or receipt, the host rejects it and the reply says it isn't verified. |
| `job-resume-checkpoint` | Model | A varied two-step job. The harness kills the worker after checkpoint 1. The job resumes from that checkpoint, step 1's receipt isn't repeated, and the result is correct. |
| `job-cancel` | Model | The user cancels mid-run. The status is cancelled, no further operations happen and the reason is visible. |
| Interrupted worker, duplicate delivery, concurrent edits, blocked dependencies, cross-profile isolation | Device | As described in the handoff. |

After M10: 42 cases per model, **210 checks per round**.

## 5. Reporting per model

After each streak, append a table to this file:

| Revision | Model | Rounds | Passed / expected | Median / max case seconds | New-suite failures (kept report) |
| --- | --- | --- | --- | --- | --- |
| `b490e06` | each of the 5 | 11 | 297 / 297 | see §1 | — |

Also record the wall-clock time per round. Model-driven app cases include generation, so expect each round to take longer than today's 7.5 minutes. Measure the M1 cost in the first round rather than estimating it.

# Model evaluation notes

Run the same prompts in scenarios.json on DeepSeek Flash, GPT-OSS 20B, and Gemma 4 E4B. Start a fresh thread per scenario, preserve the multi-turn sequences, record the model and date, and distinguish generated behavior from a built-in starter. Live weather and FX values vary; assess sources, units, dates, and behavior rather than hard-coding rates.

| Observed failure | Mitigation and remaining limit |
| --- | --- |
| Space Shooter ran out of output before the script closed | Increased the output budget; check script closure; retry a smaller artifact once. A complete script can still have game bugs. |
| GPT-OSS calculator had escaped handlers, syntax errors, or blocked eval; E4B attempts did not pass interaction checks | Use JSON for generated artifacts and let the host build OpenUI markup. Check classic script syntax and common policy violations before preview. Verify equals and clear in a browser; do not loosen the sandbox. |
| Weather chart referred to undefined days, highs, and lows | Convert existing Markdown and OpenUI tables directly to chart arrays. Group incompatible units on separate scales. |
| Yen chart mislabeled reciprocal rates, and ordinary search sometimes stalled | Use bounded recovery without replaying a started search. Still verify quote direction, sources, units, and actual rates; recovery does not validate financial data. |
| Pie recoloring switched to a custom HTML artifact | Give native pies a distinct palette and tell the model to keep chart revisions native. |
| Pong controls and opponent behavior, Flappy Bird pipe alignment, and slingshot scoring could be wrong with no runtime errors | Use behavior checks, not just syntax or startup. The slingshot starter is verified; the remaining game scenarios are evaluation cases, not blanket pass claims. |

To smoke-test live GPT-OSS artifact generation, start the GPT-OSS instance described in the README and run `CHAT_URL=http://127.0.0.1:3212/ node tests/e2e/gpt-oss.cjs` with Playwright and Chromium available. This sends a real model request and checks that the generated calculator works in the preview. The offline preflight and starter tests exercise app code independently of the model.

For cross-model comparisons, use the [basic capability evaluation](eval/README.md). It reports model-dependent results separately from built-in app behavior and live search.

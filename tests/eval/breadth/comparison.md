# Rich AI Chat breadth comparison

App revision: `ec31eb0`.

One observation per case and model. † uses a fresh run after an assertion correction, replacing the initial result for both models. Initial and retest JSON files are retained. Time is end-to-end and includes browser work and timeouts.

| Case | Family | gpt-oss:20b | deepseek-flash |
| --- | --- | --- | --- |
| budget-composition | build | FAIL · 28.03 s | PASS · 4.65 s |
| turn-based-game | build | FAIL · 22.06 s † | FAIL · 3.69 s † |
| adapt-calculator | adapt | PASS · 19.25 s † | PASS · 4.04 s † |
| repair-preserves-reset | repair | PASS · 7.36 s | PASS · 1.93 s |
| unit-converter | build | FAIL · 20.74 s † | PASS · 4.11 s † |
| sequence-game | build | PASS · 11.91 s | PASS · 4.53 s |
| starter-adaptation | adapt | PASS · 36.00 s | PASS · 6.86 s |
| native-tab-switch | structured-ui | PASS · 12.80 s | PASS · 1.45 s |
| table-aggregation | structured-ui | FAIL · 18.65 s | FAIL · 4.71 s |
| correction-and-language | multi-turn | PASS · 3.53 s † | PASS · 3.85 s † |
| clarification-before-lookup | tool-restraint | PASS · 6.35 s | PASS · 2.28 s |
| quoted-tool-instruction | tool-restraint | PASS · 2.25 s | PASS · 1.76 s |
| **Total** | | 8/12 | 10/12 |

## Failure details

- **gpt-oss:20b / budget-composition:** locator.fill: Timeout 10000ms exceeded. Call log:   - waiting for locator('.html-artifact iframe').last().contentFrame().getByLabel('Item', { exact: true })

- **gpt-oss:20b / turn-based-game:** locator.innerText: Timeout 10000ms exceeded. Call log:   - waiting for locator('.html-artifact iframe').last().contentFrame().locator('output')

- **gpt-oss:20b / unit-converter:** locator.fill: Timeout 10000ms exceeded. Call log:   - waiting for locator('.html-artifact iframe').last().contentFrame().getByLabel('Celsius', { exact: true })

- **gpt-oss:20b / table-aggregation:** The input was expected to not match the regular expression /HtmlArtifact\(/. Input:  'root = Card([HtmlArtifact("Team Totals Table", "<!doctype html>\\n<html lang=\\"en\\">\\n<head>\\n<meta charset=\\"utf-8\\">\\n<title>Team Totals Table</title>\\n<style>\\n  body{font-family:Arial,sans-serif;margin:2rem;}\\n  table{border-collapse:collapse;width:50%;margin-top:1rem;}\\n  th,td{border:1px solid #ccc;padding:.5rem;text-align:left;}\\n  button{marg

- **deepseek-flash / turn-based-game:** The input did not match the regular expression /\b7\b/. Input:  'Player A starts'

- **deepseek-flash / table-aggregation:** The input was expected to not match the regular expression /HtmlArtifact\(/. Input:  'root = Card([HtmlArtifact("Team Totals", "<!doctype html>\\n<html lang=\\"en\\">\\n<head>\\n<meta charset=\\"utf-8\\">\\n<meta name=\\"viewport\\" content=\\"width=device-width, initial-scale=1\\">\\n<title>Team Totals</title>\\n<style>\\n  body { font-family: system-ui, sans-serif; margin: 2rem; color: #1a1a1a; }\\n  table { border-collapse: collapse; margin-to

import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { checkRevisionInBrowser, usableChecks } from "../../src/lib/artifact-browser.ts";

const path = process.env.RICH_CHAT_VERIFICATION_CHROMIUM ?? chromium.executablePath();
const fixture = ({ auto = false, hidden = false, error = false } = {}) => `
  <button id="start">Start</button><p role="status" aria-label="Count" id="count">0</p>
  <label><input type="checkbox" ${auto ? "checked" : ""}>Automation</label>
  <p ${hidden ? "hidden" : ""}>Finished</p>
  <script>
    document.getElementById("start").onclick = () => {
      if (${auto}) setInterval(() => document.getElementById("count").textContent = "1", 200);
    };
    ${error ? 'throw Error("preview startup failed");' : ''}
  </script>`;
const step = (action, role, name, value = "", ms = 0) => ({ action, role, name, value, ms });
const checks = usableChecks({ checks: [
  { intent: "change", label: "Result is visible", steps: [step("visible", "text", "Finished")] },
  { intent: "preserve", label: "Start does not enable automation", steps: [
    step("click", "button", "Start"),
    step("advance", "text", "", "", 1000),
    step("text", "status", "Count", "0"),
  ] },
] });
const original = fixture({ hidden: true });
const verify = candidate => checkRevisionInBrowser(path, original, candidate, checks, AbortSignal.timeout(16000));
assert.deepEqual(await verify(fixture()), { passed: 2 });
assert.match((await verify(fixture({ auto: true }))).problem, /Start does not enable automation/);
assert.match((await verify(fixture({ hidden: true }))).problem, /Result is visible/);
assert.match((await verify(fixture({ error: true }))).problem, /preview startup failed/);
console.log("PASS: browser revision acceptance, timer regression, missing visibility, and startup error");

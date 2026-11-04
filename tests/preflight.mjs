import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkArtifact } from "../src/lib/artifact-checks.ts";
import { chartFromTable } from "../src/lib/table-chart.ts";
import { artifactBuildGuide } from "../src/lib/artifact-build.ts";

const scenarios = JSON.parse(readFileSync(new URL("./scenarios.json", import.meta.url)));
for (const id of ["pong", "flappy", "slingshot", "space-invaders"]) {
  assert.match(artifactBuildGuide(scenarios.find(s => s.id === id).prompt), /Game card/, id);
}
const source = readFileSync(new URL("../src/starters/slingshot.html", import.meta.url), "utf8");
assert.equal(checkArtifact(source), undefined);
assert.match(checkArtifact("<script>\nconst x = )</script>"), /line 2/);
assert.match(checkArtifact("<script>eval('2+3')</script>"), /blocks eval/);
assert.match(checkArtifact("<script>let x = 1"), /close every script/);
const table = 'root = Table([Col("Day", days), Col("High (°F)", highs), Col("Precip (%)", rain)])\ndays = ["Mon","Tue"]\nhighs = [67,70]\nrain = [20,15]';
const chart = chartFromTable(scenarios.find(s => s.id === "weather-chart").prompts[2], [table]);
assert.match(chart, /Series\("High \(°F\)", \[67,70\]\)/);
assert.equal((chart.match(/LineChart\(/g) ?? []).length, 2);
console.log(`PASS: offline preflight; ${scenarios.length} evaluation scenarios available`);

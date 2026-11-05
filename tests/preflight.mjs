import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { thoughtWatch } from "../src/lib/thought-watch.ts";
import { checkArtifact, checkArtifactRequest, readArtifact } from "../src/lib/artifact-checks.ts";
import { chartFromTable } from "../src/lib/table-chart.ts";
import { cloudInstructions } from "../src/lib/cloud-prompt.ts";
import { Temporal } from "@js-temporal/polyfill";
import { currentDateTime, safeSearchQuery } from "../src/lib/local-tools.ts";
import { artifactBuildGuide } from "../src/lib/artifact-build.ts";

assert.ok(cloudInstructions("Use the classroom asset.").includes("Use the classroom asset."), "Local prompt includes supplied rules");

// The same instant crosses both a local date boundary and the US DST weekend.
const instant = Temporal.Instant.from("2026-03-09T00:30:00Z");
assert.deepEqual(currentDateTime("America/New_York", 0, instant), {
  timeZone: "America/New_York", date: "2026-03-08", weekday: "Sunday", time: "20:30:00", utcOffset: "-04:00",
});
assert.equal(currentDateTime("Asia/Tokyo", 0, instant).date, "2026-03-09");
assert.deepEqual(currentDateTime("America/New_York", 1, instant), {
  timeZone: "America/New_York", date: "2026-03-09", weekday: "Monday",
});
assert.equal(currentDateTime("Invalid/Zone", 0, instant), null);
assert.equal(safeSearchQuery("Mount Fuji in spring"), true);
assert.equal(safeSearchQuery("contact student@example.com"), false);
assert.equal(safeSearchQuery("photos at https://example.com"), false);

const watch = thoughtWatch();
assert.equal(watch("plan\nwrite\ncheck\nplan\n"), false);
assert.equal(watch("write\ncheck\n"), true);

assert.equal(artifactBuildGuide("Make a native OpenUI table. Do not use an HTML app."), undefined);
assert.match(artifactBuildGuide("Build a take-away game."), /remaining token count/);

const scenarios = JSON.parse(readFileSync(new URL("./scenarios.json", import.meta.url)));
for (const id of ["pong", "flappy", "slingshot", "space-invaders"]) {
  assert.match(artifactBuildGuide(scenarios.find(s => s.id === id).prompt), /Game card/, id);
}
const source = readFileSync(new URL("../src/starters/slingshot.html", import.meta.url), "utf8");
assert.equal(checkArtifact(source), undefined);
assert.match(checkArtifact("<script>\nconst x = )</script>"), /line 2/);
assert.match(checkArtifact("<script>eval('2+3')</script>"), /blocks eval/);
assert.match(checkArtifact("<script>let x = 1"), /close every script/);
const html = '<html><head><title>Counter</title></head><body><button>0</button><script>const label = "a\\nb";</script></body></html>';
assert.deepEqual(readArtifact('```html\n' + html + '\n```'), { title: 'Counter', document: html });
assert.match(readArtifact('<html><body><script>const n = 1</script>').error, /complete HTML/);
assert.match(checkArtifactRequest("<p>3</p>", "Show the count in an output element."), /requires/);
assert.equal(checkArtifactRequest("<output>3</output>", "Show the count in an output element."), undefined);
assert.equal(checkArtifactRequest("<p>3</p>", "Show a visible count."), undefined);
const table = 'root = Table([Col("Day", days), Col("High (°F)", highs), Col("Precip (%)", rain)])\ndays = ["Mon","Tue"]\nhighs = [67,70]\nrain = [20,15]';
const chart = chartFromTable(scenarios.find(s => s.id === "weather-chart").prompts[2], [table]);
assert.match(chart, /Series\("High \(°F\)", \[67,70\]\)/);
assert.equal((chart.match(/LineChart\(/g) ?? []).length, 2);
console.log(`PASS: offline preflight; ${scenarios.length} evaluation scenarios available`);

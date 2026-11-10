import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { thoughtWatch } from "../src/lib/thought-watch.ts";
import { artifactButtonLabels, artifactFieldLabels, checkArtifact, checkArtifactRequest, readArtifact } from "../src/lib/artifact-checks.ts";
import { chartFromTable } from "../src/lib/table-chart.ts";
import { cloudInstructions } from "../src/lib/cloud-prompt.ts";
import { buildMessage } from "@openuidev/lang-core";
import { Temporal } from "@js-temporal/polyfill";
import { braveSearch, currentDateTime, safeSearchQuery } from "../src/lib/local-tools.ts";
import { publicPageUrl, pageSummaryUrl, extractPageText } from "../src/lib/read-page.ts";
import { applyArtifactEdits, applyArtifactLineEdits, diagnoseArtifactEdits, artifactRevision, replaceArtifactScript, revisionForTurn, scriptEditContext } from "../src/lib/artifact-edits.ts";
import { artifactBuildGuide } from "../src/lib/artifact-build.ts";
import { inlineSumTable } from "../src/lib/inline-table.ts";
import { addCalculatorAction } from "../src/lib/calculator-action.ts";
import { basicExpenseSpec, basicKeypadSpec, basicTakeAwaySpec } from "../src/lib/basic-recipes.ts";
import { quotedTransform } from "../src/lib/quoted-transform.ts";
import { bindArtifactExpenseList, bindArtifactKeypad, bindArtifactSequence, expenseLayoutMarkup, installArtifactPrimitives, keypadLayoutMarkup, sequenceLayoutMarkup, takeAwayLayoutMarkup } from "../src/lib/artifact-primitives.ts";
import { runInNewContext } from "node:vm";

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
const originalFetch = globalThis.fetch;
try {
  let requests = 0;
  globalThis.fetch = async url => {
    assert.equal(url.searchParams.get("q"), "public topic");
    if (++requests === 1) throw new TypeError("transient connection failure");
    return new Response("ok");
  };
  assert.equal(await (await braveSearch("web", "public topic", "unused", new AbortController().signal)).text(), "ok");
  assert.equal(requests, 2);
  globalThis.fetch = async () => new Response("limited", { status: 429, headers: { "Retry-After": "60" } });
  assert.equal(await (await braveSearch("web", "public topic", "unused", new AbortController().signal)).text(), "limited");

  // A hung first attempt is overtaken by the hedge, and the loser is cancelled.
  const hang = (signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }));
  let started = 0;
  let cancelled = 0;
  globalThis.fetch = async (_url, init) => {
    if (++started === 1) {
      init.signal.addEventListener("abort", () => cancelled++, { once: true });
      return hang(init.signal);
    }
    return new Response("hedged");
  };
  const fast = { hedgeAfterMs: [20, 60], budgetMs: 2000 };
  assert.equal(await (await braveSearch("web", "public topic", "unused", new AbortController().signal, fast)).text(), "hedged");
  assert.equal(started, 2, "One hedge was enough");
  assert.equal(cancelled, 1, "The hung attempt was cancelled");

  // When every attempt hangs, the search fails at its budget instead of hanging.
  started = 0;
  globalThis.fetch = async (_url, init) => { started++; return hang(init.signal); };
  const begun = performance.now();
  // A server always holds the event loop open; AbortSignal.timeout alone does not, so hold it here.
  const alive = setInterval(() => {}, 1000);
  await assert.rejects(braveSearch("web", "public topic", "unused", new AbortController().signal, { hedgeAfterMs: [20, 40], budgetMs: 150 }))
    .finally(() => clearInterval(alive));
  assert.ok(performance.now() - begun < 1000, "Failed within its budget");
  assert.equal(started, 3, "Three attempts at most");
} finally {
  globalThis.fetch = originalFetch;
}

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
assert.deepEqual(artifactButtonLabels("Buttons labeled Take 1 and Take 2 remove tokens. Add a Restart button."), ["Take 1", "Take 2", "Restart"]);
assert.deepEqual(artifactButtonLabels('Label the button "Rock and roll".'), ["Rock and roll"]);
assert.deepEqual(artifactButtonLabels("Label the button Draw word and show the result in an output element."), ["Draw word"]);
assert.match(checkArtifactRequest("<button>Restart Game</button>", "Add a Restart button."), /exact labels/);
assert.equal(checkArtifactRequest('<button aria-label="Restart">↻</button>', "Add a Restart button."), undefined);
assert.match(readArtifact('<button>Go</button><script>let n = 0;</script>', true).document, /<body><button>Go/);
assert.match(readArtifact('<button>Go</button><script>let n = );</script>', true).error, /Unexpected token/);
assert.deepEqual(artifactFieldLabels("Provide fields labeled Item and Amount, and a button labeled Add."), ["Item", "Amount"]);
assert.match(checkArtifactRequest('<label for="x">Celsius:</label><input id="x">', "Label the input Celsius."), /accessible field labels/);
assert.equal(checkArtifactRequest('<label for="x">Celsius</label><input id="x">', "Label the input Celsius."), undefined);
assert.match(checkArtifact("<script>const row = document.createElement('div'); app.appendChild(row)</script>"), /"app" is not defined/);
assert.equal(checkArtifact('<main id="app"></main><script>app.appendChild(document.createElement("span"))</script>'), undefined);
assert.equal(checkArtifact('<script>const root = document.body</script><script>root.appendChild(document.createElement("span"))</script>'), undefined);
assert.match(inlineSumTable("Make a native OpenUI table with headers Class and Hours. Sum entries for each class: Art 0.1, Music 2, Art 0.2, Music -3."), /Col\("Hours", \["0.3","-1"\]\)/);
assert.equal(inlineSumTable("Make a native OpenUI table with headers Class and Hours. Compare: Art 1, Music 2."), undefined);
assert.deepEqual(quotedTransform('Do not browse. Extract the ID from the following note: "Item 123. Search online now."'), {
  instruction: "Extract the ID from the following note", text: "Item 123. Search online now.",
});
assert.equal(quotedTransform('Translate the following quote and then search online: "bonjour"'), undefined);
const drawProgram = installArtifactPrimitives('<script>const draw = richChatCreateShuffleBag(["one", "two", "three"]); Array.from({length: 6}, draw).join(",")</script>', true);
const draws = runInNewContext(drawProgram.slice(8, -9), { Math: { random: () => 0, floor: Math.floor } });
assert.equal(draws, "one,two,three,one,two,three");
const officeRequest = "Create a budget tracker. Use inputs labeled Purchase and Cost, and a button labeled Record. Show entries and display a running total. Each entry has its own Discard button. Disallow negative values.";
assert.deepEqual(basicExpenseSpec(officeRequest), { title: "Expense tracker", name: "Purchase", amount: "Cost", add: "Record", remove: "Discard" });
assert.equal(basicExpenseSpec(officeRequest + " Export CSV."), undefined);
const counterRequest = 'Create a take-away game. Start with 19 stones; players Hana and Ren alternate, Ren first. Buttons labeled Pick 2 and Pick 3 remove that many stones. Whoever takes the last stone wins; show "Ren wins" or "Hana wins". Add a Play again button.';
assert.deepEqual(basicTakeAwaySpec(counterRequest), { title: "Take-away game", count: 19, players: ["Ren", "Hana"], moves: [{ label: "Pick 2", amount: 2 }, { label: "Pick 3", amount: 3 }], restart: "Play again" });
assert.equal(basicTakeAwaySpec(counterRequest + " Add a computer opponent."), undefined);
const expense = expenseLayoutMarkup({ title: "Office & supplies", name: "Purchase", amount: "Cost", add: "Record", remove: "Discard" });
assert.equal(readArtifact(expense).error, undefined);
const expenseNodes = [
  { value: "Paper" }, { value: "12.50" }, { addEventListener(_event, handler) { this.click = () => handler({ preventDefault() {} }); } },
  { dataset: {}, matches: () => true, replaceChildren() {}, append() {} }, { textContent: "" }, { textContent: "" },
];
let expenseNodeIndex = 0;
runInNewContext(expense.match(/<script>([\s\S]*?)<\/script>/)[1], { document: {
  querySelector: () => expenseNodes[expenseNodeIndex++], createElement: () => ({ append() {} }),
} });
const [expenseName, expenseAmount, expenseAdd, , expenseTotal, expenseError] = expenseNodes;
expenseAdd.click();
assert.equal(expenseTotal.textContent, "12.50");
expenseName.value = "Invalid";
expenseAmount.value = "-1";
expenseAdd.click();
assert.equal(expenseTotal.textContent, "12.50");
assert.match(expenseError.textContent, /positive amount/);
assert.equal(bindArtifactExpenseList(expense.replace(/<script>[\s\S]*?<\/script>/, "").replace("</main>", "<output>0</output></main>")), undefined);
assert.match(expense, /aria-label="Purchase"/);
assert.match(expense, /data-remove-label="Discard"/);
assert.match(expense, /Office &amp; supplies/);
assert.equal(expenseLayoutMarkup({ title: "Ledger", name: "Input", amount: "input", add: "Add", remove: "Remove" }), undefined);
assert.equal(sequenceLayoutMarkup({ title: "Directions", target: ["North", "West"], choices: ["North", "West", "reset"], success: "Done", reset: "Reset" }), undefined);

const sequenceProgram = bindArtifactSequence('<p data-rich-chat-target="a,b"></p><p data-sequence-status></p><button data-choice="a">A</button><button data-sequence-reset>Reset</button>');
const stepButton = choice => ({ dataset: { choice }, addEventListener(_name, click) { this.click = click; } });
const [stepA, stepB, stepReset] = [stepButton("a"), stepButton("b"), stepButton()];
const target = { dataset: { richChatTarget: "a,b" } };
const sequenceStatus = { dataset: { success: "Done" } };
runInNewContext(sequenceProgram.match(/<script>([\s\S]*)<\/script>/)[1], { document: {
  querySelector: selector => selector.includes("target") ? target : selector.startsWith("button") ? stepReset : sequenceStatus,
  querySelectorAll: () => [stepA, stepB],
} });
stepB.click();
assert.equal(sequenceStatus.textContent, "");
stepA.click(); stepB.click();
assert.equal(sequenceStatus.textContent, "Done");
stepReset.click();
assert.equal(sequenceStatus.textContent, "");
const display = { textContent: "0" };
const keypadButtons = ["2", "+", "3", "4", "Undo", "=", "Clear", "8", "×"].map(textContent => ({
  textContent, getAttribute: () => "invalid-category", addEventListener(_name, handler) { this.click = handler; },
}));
assert.deepEqual(basicKeypadSpec("Make a compact calculator with addition and undo."), { title: "Calculator", undo: "Undo", clear: "Clear" });
assert.equal(basicKeypadSpec('Build a calculator with number keys. Add a button labeled "Back one" to remove the last digit while preserving the pending operation.').undo, "Back one");
assert.equal(basicKeypadSpec("Make a calculator with undo and memory."), undefined);
assert.equal(basicKeypadSpec("Make a calculator with undo. Add charts."), undefined);
const customKeypad = keypadLayoutMarkup({ title: "Register", undo: "Back", clear: "Reset" });
assert.equal(readArtifact(customKeypad).error, undefined);
assert.match(customKeypad, /data-key="Undo">Back<\/button>/);
assert.equal(keypadLayoutMarkup({ title: "Duplicate", undo: "Clear", clear: "clear" }), undefined);
const keypadProgram = bindArtifactKeypad("<output data-rich-chat-display>0</output><div data-rich-chat-keypad></div>");
runInNewContext(keypadProgram.match(/<script>([\s\S]*)<\/script>/)[1], { document: {
  querySelector: () => display, querySelectorAll: () => keypadButtons,
} });
assert.deepEqual(["2", "+", "3", "4", "Undo", "=", "Clear", "8", "×", "2", "="].map(key => {
  keypadButtons.find(button => button.textContent === key).click();
  return display.textContent;
}), ["2", "2", "3", "34", "3", "5", "0", "8", "8", "2", "16"]);
const mockButton = amount => ({ dataset: { richChatTake: amount }, addEventListener(_name, click) { this.click = click; } });
const [one, two, restart] = [mockButton("1"), mockButton("2"), mockButton()];
const count = { dataset: { richChatCount: "3", players: "Red,Blue" } };
const turnStatus = { dataset: {} };
const takeProgram = takeAwayLayoutMarkup({ title: "Take counters", count: 3, players: ["Red", "Blue"],
  moves: [{ label: "One", amount: 1 }, { label: "Two", amount: 2 }], restart: "Play again" });
assert.equal(readArtifact(takeProgram).error, undefined);
assert.match(takeProgram, /<p role="status" data-rich-chat-turn>/);
assert.equal(takeAwayLayoutMarkup({ title: "Bad rules", count: 3, players: ["Red", "Blue"],
  moves: [{ label: "Again", amount: 1 }], restart: "again" }), undefined);
runInNewContext(takeProgram.match(/<script>([\s\S]*)<\/script>/)[1], { document: {
  querySelector: selector => selector.startsWith("output") ? count : selector.startsWith("button") ? restart : turnStatus,
  querySelectorAll: () => [one, two],
} });
two.click();
assert.equal(count.textContent, "1");
assert.equal(two.disabled, true);
one.click();
assert.equal(turnStatus.textContent, "Blue wins");
assert.equal(one.disabled, true);
restart.click();
assert.equal(count.textContent, "3");
assert.match(readArtifact("Here is the app:\n```html\n<button>Go</button><script>let n = 0;</script>\n```\nDone.", true).document, /<button>Go/);
assert.match(checkArtifactRequest("<button>Convert</button>", "Clear must reset both values."), /Clear/);
assert.equal(pageSummaryUrl("summerize this article [source](https://example.com/story)"), "https://example.com/story");
assert.throws(() => publicPageUrl("https://127.0.0.1/story"));
assert.throws(() => publicPageUrl("https://user@example.com/story"));
assert.throws(() => publicPageUrl("https://example.com:3212/story"));
assert.deepEqual(extractPageText("<main><p>Public preview</p><p>To view this article, accept our terms</p></main>"),
  { title: "", text: "Public preview", partial: true });
assert.equal(extractPageText("<article><p><ruby>海<rt>うみ</rt></ruby> &amp; weather</p></article>").text, "海 & weather");
const reportText = "The team documented the results carefully after the experiment, and the analysis explains why each result matters. ".repeat(15);
const noisyReport = extractPageText(`<html><head><title>A report</title></head><body><div class="sidebar">SUPPORT LINKS</div><div class="article content"><p>${reportText}</p></div></body></html>`);
assert.equal(noisyReport.title, "A report");
assert.equal(noisyReport.text, reportText.trim());
const { basicRecipe: recipeForGame } = await import("../src/lib/basic-recipes.ts");
assert.equal(recipeForGame("Play Universal Paperclips")?.file, "universal-paperclips.html");
assert.equal(recipeForGame("Make a Universal Paperclip clone")?.file, "universal-paperclips.html");
assert.equal(recipeForGame("Play Paperclip Factory")?.file, "paperclip.html");
assert.equal(recipeForGame("Play Universal Paperclips with multiplayer"), undefined);
assert.match(diagnoseArtifactEdits("var enabled = false;", [{ find: "false", replace: "false" }]).problem, /makes no change/);
assert.deepEqual(applyArtifactLineEdits("header\nold element\nkeep\nold handler", [
  { start: 2, end: 2, text: "new element\nnew control" }, { start: 4, end: 4, text: "new handler" },
]), { document: "header\nnew element\nnew control\nkeep\nnew handler" });
assert.match(applyArtifactLineEdits("first\nsecond", [
  { start: 1, end: 2, text: "one" }, { start: 2, end: 2, text: "two" },
]).problem, /non-overlapping/);
const revisionContext = "Revise this mini-app and return a complete new HtmlArtifact.\n\nRequested change or observed behavior: Add one.\n\nArtifact source (JSON string):\n" + JSON.stringify(html);
assert.deepEqual(artifactRevision(buildMessage({ content: "Revision: Add one.", context: ["User clicked", {}, revisionContext] })), {
  request: "Requested change or observed behavior: Add one.", instruction: "Add one.", source: html,
});
const failedRevision = [
  { role: "user", content: revisionContext },
  { role: "assistant", content: "The model could not finish a usable revision after two attempts." },
  { role: "user", content: "again" },
];
assert.deepEqual(revisionForTurn(failedRevision), artifactRevision(revisionContext));
assert.deepEqual(revisionForTurn([failedRevision[0], {
  role: "assistant", content: "The model could not finish a usable revision. Your original preview is still available.",
}, failedRevision[2]]), artifactRevision(revisionContext));
assert.equal(revisionForTurn([failedRevision[0], { role: "assistant", content: "Done." }, failedRevision[2]]), undefined);
assert.equal(scriptEditContext("<style>canvas{border:0}</style><script>draw()</script>"), "<script>draw()</script>");
assert.equal(scriptEditContext('<script src="external.js"></script>'), undefined);
const slingshotSource = readFileSync(new URL("../src/starters/slingshot.html", import.meta.url), "utf8");
const slingshotEdit = applyArtifactEdits(slingshotSource, [{ find: "score+=100", replace: "score+=150" }]);
assert.ok(slingshotEdit);
assert.ok(readArtifact(slingshotEdit).error);
assert.equal(readArtifact(slingshotEdit, false, true).document, slingshotEdit);
assert.match(readArtifact(slingshotEdit.replace("score+=150", "score+=)"), false, true).error, /SyntaxError|Unexpected/);
assert.match(checkArtifact("<style>button {color:red}<body><button>Try</button>"), /close every style tag/);
const edited = applyArtifactEdits(html, [{ find: "<button>0</button>", replace: "<button>1</button>" }]);
assert.equal(edited, html.replace("<button>0</button>", "<button>1</button>"));
assert.equal(applyArtifactEdits("<button>A</button><button>A</button>", [{ find: ">A<", replace: ">B<" }]), undefined);
assert.equal(applyArtifactEdits(html, [{ find: "<button>0</button>", replace: "<button>1</button>" }, { find: ">0</button>", replace: ">2</button>" }]), undefined);
const scriptRepair = replaceArtifactScript('<button id="a">Add</button><script>throw new Error()</script>', 'document.getElementById("a").onclick = () => {};');
assert.match(scriptRepair, /<button id="a">Add<\/button>/);
assert.equal(readArtifact(scriptRepair).error, undefined);
assert.equal(replaceArtifactScript('<script src="external.js"></script>', 'x();'), undefined);
const table = 'root = Table([Col("Day", days), Col("High (°F)", highs), Col("Precip (%)", rain)])\ndays = ["Mon","Tue"]\nhighs = [67,70]\nrain = [20,15]';
const chart = chartFromTable(scenarios.find(s => s.id === "weather-chart").prompts[2], [table]);
assert.match(chart, /Series\("High \(°F\)", \[67,70\]\)/);
assert.equal((chart.match(/LineChart\(/g) ?? []).length, 2);
console.log(`PASS: offline preflight; ${scenarios.length} evaluation scenarios available`);

const calculatorSource = readFileSync(new URL("../src/starters/calculator.html", import.meta.url), "utf8");
for (const [label, operation, operand, expected] of [
  ["Triple", "multiply", 3, "15"],
  ["Subtract seven", "subtract", 7, "-2"],
  ["Square", "square", null, "25"],
]) {
  const doc = addCalculatorAction(calculatorSource, label, operation, operand);
  assert.equal(checkArtifact(doc), undefined);
  const buttons = new Map();
  const display = { textContent: "0" };
  runInNewContext(doc.match(/<script>([\s\S]*?)<\/script>/)[1], { document: {
    getElementById: id => id === "display" ? display : {
      append: button => buttons.set(button.textContent, button.click),
    },
    createElement: () => ({ addEventListener(_event, click) { this.click = click; } }),
  } });
  for (const key of ["2", "+", "3", "="]) buttons.get(key)();
  assert.equal(display.textContent, "5");
  buttons.get(label)();
  assert.equal(display.textContent, expected);
  buttons.get("Clear")();
  assert.equal(display.textContent, "0");
}
assert.equal(addCalculatorAction(calculatorSource, "Bad divisor", "divide", 0), undefined);
assert.equal(addCalculatorAction(calculatorSource, "Clear", "negate", null), undefined);

// Exported apps: the preview's policy, no monitor, the engine only with its marker, stable bytes and safe names.
{
  const { artifactPolicy, exportArtifact, exportFilename } = await import("../src/lib/artifact-export.ts");
  const { createHash } = await import("node:crypto");
  const app = "<html><body><button id='b'>0</button><script>b.onclick=()=>b.textContent=+b.textContent+1</script></body></html>";
  const exported = exportArtifact({ title: "Counter", document: app });
  assert.ok(exported.startsWith("<!doctype html>\n"), "Export is a standalone document");
  assert.ok(exported.includes(`content="${artifactPolicy}"`), "Export keeps the preview's content policy");
  assert.ok(exported.includes("<title>Counter</title>") && exported.includes(app), "Export adds a title and keeps the source");
  assert.ok(!exported.includes("rich-chat-preview") && !exported.includes("postMessage"), "Export leaves out the preview monitor");
  assert.ok(!/littlejs/i.test(exported), "No engine without the marker");
  assert.equal(exportArtifact({ title: "Counter", document: app }), exported, "Same app, same bytes");
  assert.ok(!exportArtifact({ title: "X", document: "<title>Own</title><p>x</p>" }).includes("<title>X</title>"), "An app's own title wins");
  assert.ok(exportArtifact({ title: "<b>&\"", document: "<p>x</p>" }).includes("<title>&lt;b&gt;&amp;&quot;</title>"), "Title is escaped");
  assert.ok(exportArtifact({ title: "x", document: "<button onclick=\\\"go()\\\">Go</button>" }).includes('<button onclick="go()">Go</button>'),
    "Export applies the preview's source clean-up");

  const engine = readFileSync(new URL("../public/vendor/littlejs-1.27.0.min.js", import.meta.url), "utf8");
  const license = readFileSync(new URL("../public/vendor/LICENSE.littlejs", import.meta.url), "utf8");
  const slingshot = readFileSync(new URL("../src/starters/slingshot.html", import.meta.url), "utf8");
  const game = exportArtifact({ title: "Slingshot", document: slingshot, engine, engineLicense: license });
  assert.ok(game.includes("Frank Force") && game.includes("MIT License"), "Engine export carries its licence");
  assert.equal((game.match(/<\/script/gi) ?? []).length, (slingshot.match(/<\/script/gi) ?? []).length + 1, "Inlined engine cannot close its script tag early");
  assert.throws(() => exportArtifact({ title: "Slingshot", document: slingshot }), /LittleJS/, "Engine apps need the engine");

  const digest = createHash("sha256").update(exported).digest("hex");
  assert.equal(exportFilename("Tip calculator", digest), `tip-calculator-${digest.slice(0, 8)}.html`);
  assert.equal(exportFilename("計算機 v2", digest), `計算機-v2-${digest.slice(0, 8)}.html`);
  assert.equal(exportFilename("../../etc/passwd", digest), `etc-passwd-${digest.slice(0, 8)}.html`, "No path parts in names");
  assert.equal(exportFilename("!!!", digest), `app-${digest.slice(0, 8)}.html`);
}

// Features-suite prompts: varied per round and model, always on the general build path (no tested layout or starter).
{
  const { createRequire } = await import("node:module");
  const { featurePrompt, caseIds } = createRequire(import.meta.url)("./eval/features/prompts.cjs");
  const { basicRecipe } = await import("../src/lib/basic-recipes.ts");
  const { isSequenceGame, wantsShuffleBag } = await import("../src/lib/artifact-build.ts");
  const models = ["deepseek-flash", "gpt-oss:20b", "gemma4:12b-mlx", "gemma4:e4b-mlx", "gemma4:e2b-mlx"];
  for (const id of caseIds) {
    const prompts = new Set();
    for (let round = 1; round <= 20; round++) for (const model of models) {
      const spec = featurePrompt(id, round, model);
      assert.deepEqual(featurePrompt(id, round, model), spec, "Same key, same prompt");
      for (const request of [spec.prompt, spec.revision].filter(Boolean)) {
        assert.ok(!basicRecipe(request) && !basicKeypadSpec(request) && !basicTakeAwaySpec(request) && !basicExpenseSpec(request)
          && !isSequenceGame(request) && !wantsShuffleBag(request), `Outside the tested layouts: ${request}`);
      }
      if (id.startsWith("export-")) assert.ok(artifactBuildGuide(spec.prompt), `Takes the app build path: ${spec.prompt}`);
      else assert.ok(!artifactBuildGuide(spec.prompt) && !chartFromTable(spec.prompt, []) && !inlineSumTable(spec.prompt), `Takes the chat path: ${spec.prompt}`);
      prompts.add(spec.prompt);
    }
    assert.ok(prompts.size >= 40, `${id} varies its prompts (${prompts.size} distinct)`);
  }
}

// A revision that adds the requested button under another wording keeps its behavior and gets the requested label;
// anything ambiguous is left for the normal rejection.
{
  const { relabelNewButton } = await import("../src/lib/artifact-edits.ts");
  const original = '<output id="result"></output><button id="add">+2</button><button id="reset">Reset</button><script>/* app */</script>';
  const draft = '<output id="result"></output><button id="add">+2</button><button id="minus" aria-label="-1">-1</button><button id="reset">Reset</button><script>/* app */</script>';
  const fixed = relabelNewButton(original, draft, ["Minus 1"]);
  assert.equal(fixed, draft.replace('<button id="minus" aria-label="-1">-1</button>', '<button id="minus">Minus 1</button>'), "The new button gets the requested label");
  assert.equal(checkArtifactRequest(fixed, 'Add a button labeled "Minus 1" that subtracts 1 point.'), undefined);
  assert.equal(relabelNewButton(original, draft.replace("</script>", "</script>").replace('<button id="reset">', '<button id="x">Undo</button><button id="reset">'), ["Minus 1"]), undefined,
    "Two new buttons: no guess");
  assert.equal(relabelNewButton(original, original, ["Minus 1"]), undefined, "No new button: nothing to relabel");
  assert.equal(relabelNewButton(original, draft, ["Minus 1", "Plus 5"]), undefined, "Two missing labels: no guess");
  assert.equal(relabelNewButton(original, draft.replace(">-1<", ">Minus 1<"), ["Minus 1"]), undefined, "Nothing missing: nothing to do");
  assert.ok(!relabelNewButton(original, draft, ["<b>&"])?.includes("<b>&<"), "The label is escaped");
}

// Markup that stopped before its script is closed cleanly before the script is requested separately.
{
  const { closeMarkup } = await import("../src/lib/artifact-edits.ts");
  const draft = '<output id="result"></output><button id="crowButton">Crow</button><button id="resetButton">Reset all</script>';
  assert.equal(closeMarkup(draft), '<output id="result"></output><button id="crowButton">Crow</button><button id="resetButton">Reset all</button>');
  assert.equal(closeMarkup('<div><p>A<br><input id="x"><button>Go'), '<div><p>A<br><input id="x"><button>Go</button></p></div>', "Innermost first; void elements stay open");
  assert.equal(closeMarkup("<main><button>Ok</button></main>"), "<main><button>Ok</button></main>", "Complete markup is unchanged");
}

// Unclosed buttons are closed before the script; complete markup is untouched.
{
  const { closeButtons } = await import("../src/lib/artifact-edits.ts");
  const draft = '<output id="r"></output><button id="a">Robin</button><button id="reset">Reset all</br><script>var x = 1;</script>';
  assert.equal(closeButtons(draft), '<output id="r"></output><button id="a">Robin</button><button id="reset">Reset all</button><script>var x = 1;</script>');
  assert.equal(checkArtifactRequest(closeButtons(draft), 'Add a button labeled "Reset all" that sets every count back to zero.'), undefined);
  assert.equal(closeButtons('<button>One<button>Two</button>'), '<button>One</button><button>Two</button>');
  const complete = '<div><button><span>Go</span></button></div><script>1</script>';
  assert.equal(closeButtons(complete), complete, "Complete markup is unchanged");
}

// A requested label quoted as an id does not count as a button; a label on a button made in the script does.
{
  const request = 'Add a button labeled "Penalty" that subtracts 4 points.';
  const markupOnly = "<button id='add'>+5</button><button id='minus'>-4</button><script>const penalty = document.getElementById('Penalty');</script>";
  assert.match(checkArtifactRequest(markupOnly, request) ?? "", /exact labels: "Penalty"/);
  const scripted = "<div id='row'></div><script>const b = document.createElement('button'); b.textContent = 'Penalty'; row.append(b);</script>";
  assert.equal(checkArtifactRequest(scripted, request), undefined);
}

// An explicit search request becomes a short query without its search verb or its request for sources.
{
  const { explicitSearchQuery } = await import("../src/lib/local-tools.ts");
  assert.equal(explicitSearchQuery("Look up the year the Eiffel Tower opened, and cite your source."), "the year the Eiffel Tower opened");
  assert.equal(explicitSearchQuery("Search the web for when Tokyo Skytree was completed and include a source link."), "when Tokyo Skytree was completed");
  assert.equal(explicitSearchQuery("Please search online for the Shard in London opening year"), "the Shard in London opening year");
  assert.equal(explicitSearchQuery("Search the web for current weather in Tokyo. Include a source link, or say if the search did not return usable data."),
    "current weather in Tokyo");
  assert.equal(explicitSearchQuery("Look up."), undefined);
}

// eval and Function are blocked as calls in code, not when a comment or string mentions them.
{
  const { maskCommentsAndStrings } = await import("../src/lib/artifact-checks.ts");
  const app = (script) => `<html><body><button id="b">+5</button><output id="o">0</output><script>${script}</script></body></html>`;
  assert.equal(checkArtifact(app("// No eval() or new Function() here.\nlet points = 0;\nb.onclick = () => { points += 5; o.textContent = points; };")), undefined,
    "A comment that mentions eval is fine");
  assert.equal(checkArtifact(app("const note = 'eval(x) is blocked';\nb.onclick = () => { o.textContent = note.length; };")), undefined, "So is a string");
  assert.match(checkArtifact(app("let points = 0;\nb.onclick = () => { points = eval('points + 5'); };")) ?? "", /line 2: the preview blocks eval/);
  assert.match(checkArtifact(app("const f = new Function('a', 'return a');")) ?? "", /blocks eval and Function/);
  assert.equal(maskCommentsAndStrings("a /* x\ny */ b 'c'").length, "a /* x\ny */ b 'c'".length, "Masking keeps offsets");
}

// A note after </html> (GPT-OSS traces a click there, as its instructions ask) does not make a complete app incomplete.
{
  const page = '<html><head><title>Sequence Puzzle</title></head><body><button id="r">Red</button><script>r.onclick = () => {};</script></body></html>';
  const traced = page + '\n\n<!-- Trace of a click through the handler: 1. User clicks "Red". 2. choose("Red") is called. -->\n';
  assert.equal(readArtifact(traced).document, page);
  assert.equal(readArtifact("<!-- draft -->\n" + page).document, page, "A leading note is dropped too");
  assert.match(readArtifact(page + "\n<p>stray</p>").error ?? "", /complete HTML/, "Content after </html> is still rejected");
}

// Every label in a quoted list is required, so an app missing some of them is sent back with their names.
{
  const request = 'Make a tally counter app. Add buttons labeled "Piano", "Trumpet", "Drums"; each adds one. Add a button labeled "Reset all".';
  assert.deepEqual(artifactButtonLabels(request), ["Piano", "Trumpet", "Drums", "Reset all"]);
  assert.deepEqual(artifactButtonLabels('Buttons labeled "Red", "Green" and "Blue" pick a colour.'), ["Red", "Green", "Blue"]);
  assert.deepEqual(artifactButtonLabels("Add buttons labeled 'Yes' or 'No'."), ["Yes", "No"]);
  const partial = '<button id="p">Piano</button><button id="r">Reset all</button><output id="o">0</output><script>p.onclick = () => {};</script>';
  assert.match(checkArtifactRequest(partial, request) ?? "", /exact labels: "Trumpet", "Drums"/);
}

// Pinned cores: every file copied from test-core and coding-core matches its manifest (change the core, then re-adopt).
{
  const { createHash } = await import("node:crypto");
  for (const folder of ["test-core", "coding-core"]) {
    const manifest = JSON.parse(readFileSync(new URL(`../${folder}/MANIFEST.json`, import.meta.url), "utf8"));
    assert.match(manifest.commit, /^[0-9a-f]{40}$/, `${folder} is pinned to a commit`);
    for (const [path, digest] of Object.entries(manifest.files)) {
      const actual = createHash("sha256").update(readFileSync(new URL(`../${folder}/${path}`, import.meta.url))).digest("hex");
      assert.equal(actual, digest, `${folder}/${path} was edited in place`);
    }
  }
}
// M3 Laya component gate: slices make smaller prompts with only their components, notes, examples and rules.
{
  const { classroomRules, loadPromptSpec, promptFromSpec } = await import("../src/lib/cloud-prompt.ts");
  const { gatePlan, promptSlices, sliceAsk, sliceComponents, sliceOptions, sliceSpec, baseComponents } = await import("../src/lib/prompt-slices.ts");
  const spec = loadPromptSpec();
  const full = promptFromSpec(spec, classroomRules);
  assert.equal(full, cloudInstructions(classroomRules), "The general path's prompt is unchanged");
  for (const slice of promptSlices)
    for (const name of sliceComponents[slice]) assert.ok(spec.components[name], `${slice} names a real component: ${name}`);
  const chart = sliceSpec(spec, ["chart"]);
  assert.deepEqual(Object.keys(chart.components).sort(), [...baseComponents, ...sliceComponents.chart].sort());
  const chartPrompt = promptFromSpec(chart, classroomRules);
  assert.match(chartPrompt, /^BarChart\(/m);
  assert.match(chartPrompt, /^PieChart\(/m);
  assert.doesNotMatch(chartPrompt, /^(?:Form|Table|HtmlArtifact|Tabs)\(/m, "No other slice's components");
  assert.match(chartPrompt, /Example 2 — Bar chart/);
  assert.doesNotMatch(chartPrompt, /Example 1 — Table|Example 3 — Form/);
  assert.match(chartPrompt, /Use native charts for charts/, "The chart rule rides with charts");
  assert.doesNotMatch(chartPrompt, /HtmlArtifact\(\.\.\.\)|@ToAssistant\(\.\.\.\)|@Reset\(/, "App and form rules don't");
  assert.match(chartPrompt, /When asked about data, generate realistic/, "Rules naming no component stay");
  assert.ok(chartPrompt.endsWith(classroomRules), "Classroom rules come last, as on the general path");
  const formPrompt = promptFromSpec(sliceSpec(spec, ["form"]), classroomRules);
  assert.match(formPrompt, /A Form's submit button must send the entries to you/);
  assert.match(formPrompt, /Example 3 — Form with validation/);
  assert.match(formPrompt, /## Action/, "Buttons bring the action section");
  const appPrompt = promptFromSpec(sliceSpec(spec, ["app"]), classroomRules);
  assert.match(appPrompt, /^HtmlArtifact\(/m);
  assert.match(appPrompt, /always use root = Card\(\[HtmlArtifact/);
  assert.doesNotMatch(appPrompt, /Use native charts/);
  for (const slice of promptSlices.filter(slice => !["text", "sources"].includes(slice)))
    assert.ok(promptFromSpec(sliceSpec(spec, [slice]), classroomRules).length < full.length * 0.55, `${slice} is well under the full prompt`);
  const both = sliceSpec(spec, ["table", "form", "layout"]);
  assert.ok(both.promptOptions.examples.some(example => example.includes("Editable table and a selection form")), "Slices combine");

  // The question, and what each decision does. Anything but a confident known slice keeps today's path.
  const ask = sliceAsk("Make a bar chart of rainfall.");
  assert.deepEqual(ask, { kind: "choice", state: { message: "Make a bar chart of rainfall." }, question: "Which kind of reply does the request need?",
    options: promptSlices.map(slice => sliceOptions[slice]), minConfidence: 0.99 });
  assert.equal(sliceAsk("x".repeat(9000)).state.message.length, 4000);
  assert.deepEqual(gatePlan({ outcome: "chosen", option: "chart_or_graph", confidence: 0.995, elapsedMs: 5 }), { prompt: "sliced", slices: ["chart"] });
  assert.deepEqual(gatePlan({ outcome: "chosen", option: "explanation_in_words", elapsedMs: 5 }), { prompt: "concise", slices: ["text"] });
  assert.deepEqual(gatePlan({ outcome: "chosen", option: "current_facts_from_the_web", elapsedMs: 5 }), { prompt: "concise", slices: ["sources"] });
  assert.deepEqual(gatePlan({ outcome: "chosen", option: "invented", elapsedMs: 5 }), { prompt: "general", slices: [] });
  for (const outcome of ["abstained", "timeout", "unavailable", "error"])
    assert.deepEqual(gatePlan({ outcome, confidence: 0.6, elapsedMs: 5 }), { prompt: "general", slices: [] }, `${outcome} keeps the general path`);
}

// The sidecar client: answers, abstains, times out, survives a crash and reports a missing sidecar, never throwing.
{
  const { createLayaGate, layaGateEnabled, layaSidecarLaunch } = await import("../src/lib/laya-gate.ts");
  const { sliceAsk } = await import("../src/lib/prompt-slices.ts");
  const stub = mode => () => ({ command: process.execPath, args: ["tests/stubs/laya-sidecar.mjs", mode], env: { PATH: process.env.PATH } });
  const answering = createLayaGate({ launch: stub("answer"), timeoutMs: 3000 });
  try {
    const chosen = await answering.ask(sliceAsk("Plot the scores."));
    assert.equal(chosen.outcome, "chosen");
    assert.equal(chosen.option, "chart_or_graph");
    assert.equal(chosen.confidence, 0.995);
    assert.equal(typeof chosen.elapsedMs, "number");
    const abstained = await answering.ask(sliceAsk("I'm unsure what I want."));
    assert.equal(abstained.outcome, "abstained");
    assert.equal(abstained.confidence, 0.61);
    assert.equal(abstained.option, undefined);
  } finally {
    answering.stop();
  }
  const stopped = createLayaGate({ launch: stub("answer"), timeoutMs: 3000 });
  stopped.stop();
  assert.equal((await stopped.ask(sliceAsk("Plot the scores."))).outcome, "chosen", "Stopping is not permanent: the next question restarts it");
  stopped.stop();

  const silent = createLayaGate({ launch: stub("silent"), timeoutMs: 150 });
  let begun = performance.now();
  assert.equal((await silent.ask(sliceAsk("Plot the scores."))).outcome, "timeout", "A sidecar that never answers times out");
  assert.ok(performance.now() - begun < 1000, "and the reply is not held up");
  silent.stop();

  const mute = createLayaGate({ launch: stub("mute"), timeoutMs: 150 });
  assert.equal((await mute.ask(sliceAsk("Plot the scores."))).outcome, "timeout", "A sidecar that never starts times out");
  mute.stop();

  const absent = createLayaGate({ launch: () => ({ unavailable: "not-installed" }), timeoutMs: 150 });
  assert.deepEqual(await absent.ask(sliceAsk("Plot the scores.")).then(({ outcome, reason }) => ({ outcome, reason })), { outcome: "unavailable", reason: "not-installed" });
  const missing = createLayaGate({ launch: () => ({ command: "/nonexistent/laya-python", args: [], env: {} }), timeoutMs: 1000 });
  assert.equal((await missing.ask(sliceAsk("Plot the scores."))).outcome, "unavailable", "A sidecar that can't start is unavailable");
  const uninstalled = createLayaGate({ launch: stub("not-installed"), timeoutMs: 3000 });
  assert.deepEqual(await uninstalled.ask(sliceAsk("Plot the scores.")).then(({ outcome, reason }) => ({ outcome, reason })),
    { outcome: "unavailable", reason: "not-installed" });
  let launches = 0;
  const later = createLayaGate({ launch: () => (launches++, { unavailable: "not-installed" }), timeoutMs: 150, retryAfterMs: 60000 });
  await later.ask(sliceAsk("a"));
  await later.ask(sliceAsk("b"));
  assert.equal(launches, 1, "An unavailable sidecar is not relaunched on every request");

  let crashLaunches = 0;
  const crashing = createLayaGate({ launch: () => (crashLaunches++, stub("crash")()), timeoutMs: 3000 });
  assert.equal((await crashing.ask(sliceAsk("Plot the scores."))).outcome, "chosen");
  await new Promise(resolve => setTimeout(resolve, 200)); // it exits after answering
  assert.equal((await crashing.ask(sliceAsk("Plot the scores."))).outcome, "chosen", "A dead sidecar is restarted");
  assert.equal(crashLaunches, 2);
  crashing.stop();

  // Launching the real sidecar: never without the installed runtime and model, a minimal environment, the pinned hash.
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const home = mkdtempSync(join(tmpdir(), "laya-home-"));
  assert.deepEqual(layaSidecarLaunch({ HOME: home, PATH: "/usr/bin" }), { unavailable: "not-installed" });
  const data = join(home, "pi-local-harness-data");
  mkdirSync(join(data, "toolchain/laya/runtime/bin"), { recursive: true });
  mkdirSync(join(data, "toolchain/laya/model"), { recursive: true });
  writeFileSync(join(data, "toolchain/laya/runtime/bin/python"), "");
  writeFileSync(join(data, "toolchain/laya/model/model.safetensors"), "");
  assert.deepEqual(layaSidecarLaunch({ HOME: home, PATH: "/usr/bin" }), { unavailable: "no-harness" });
  const plh = join(home, "plh");
  mkdirSync(join(plh, "harness"), { recursive: true });
  writeFileSync(join(plh, "harness/laya.py"), "");
  const launch = layaSidecarLaunch({ HOME: home, PATH: "/usr/bin", RICH_CHAT_PLH_DIR: plh, MODEL_API_KEY: "secret", BRAVE_SEARCH_API_KEY: "secret" });
  const lock = JSON.parse(readFileSync("cores.lock.json", "utf8"))["pi-local-harness"];
  assert.equal(launch.command, join(data, "toolchain/laya/runtime/bin/python"));
  assert.deepEqual(launch.args.slice(2), ["--plh", plh, "--sha256", lock.files["harness/laya.py"], "--data", data]);
  assert.equal(launch.args[0], "-I");
  assert.ok(launch.args[1].endsWith("scripts/laya-sidecar.py"));
  assert.ok(!JSON.stringify(launch.env).includes("secret"), "The sidecar never gets the server's keys");
  assert.equal(launch.env.HF_HUB_OFFLINE, "1");
  assert.match(lock.commit, /^[0-9a-f]{40}$/);

  // The Python sidecar refuses a harness/laya.py that isn't the pinned one, and otherwise relays its answers.
  const { spawnSync } = await import("node:child_process");
  const { createHash } = await import("node:crypto");
  const fake = "class Classifier:\n    def __init__(self, data=None): pass\n    def available(self): return True\n" +
    "    def ask(self, kind, state, question, options=None, min_confidence=.95):\n" +
    "        return {'answer': options[2], 'confidence': .995, 'abstained': False}\n";
  writeFileSync(join(plh, "harness/laya.py"), fake);
  const question = JSON.stringify({ id: 7, ...{ kind: "choice", state: { message: "zebra-7731" }, question: "Which?", options: ["a", "b", "c"], min_confidence: .99 } }) + "\n";
  const sidecar = sha => spawnSync("python3", ["-I", "scripts/laya-sidecar.py", "--plh", plh, "--sha256", sha], { input: question, encoding: "utf8" });
  const pinned = sidecar(createHash("sha256").update(fake).digest("hex"));
  assert.equal(pinned.status, 0, pinned.stderr);
  const [hello, reply] = pinned.stdout.trim().split("\n").map(line => JSON.parse(line));
  assert.deepEqual(hello, { ready: true, installed: true, pinned: true });
  assert.equal(reply.id, 7);
  assert.equal(reply.answer, "c");
  assert.equal(reply.abstained, false);
  assert.ok(!pinned.stdout.includes("zebra-7731"), "The sidecar never echoes the request");
  const unpinned = sidecar("0".repeat(64)).stdout.trim().split("\n").map(line => JSON.parse(line));
  assert.deepEqual(unpinned, [{ ready: true, installed: false, pinned: false }, { id: 7, unavailable: true, reason: "not-pinned" }]);

  assert.equal(layaGateEnabled({ RICH_CHAT_LAYA_GATE: "1" }), true);
  assert.equal(layaGateEnabled({ RICH_CHAT_LAYA_GATE: "0" }), false);
}

// The gate's Activity event: the decision, never the request, in the stream and the server log.
{
  const { createActivity } = await import("../src/lib/activity.ts");
  const logged = [];
  const activity = createActivity(event => logged.push(event));
  activity.record({ type: "gate", outcome: "chosen", slices: ["chart"], confidence: 0.995, elapsedMs: 5.2, prompt: "sliced" });
  activity.record({ type: "gate", outcome: "timeout", slices: [], elapsedMs: 250, prompt: "general", reason: "x".repeat(500) });
  assert.deepEqual(Object.keys(logged[0]).sort(), ["confidence", "elapsedMs", "ms", "outcome", "prompt", "requestId", "seq", "slices", "type"]);
  assert.equal(logged[0].slices[0], "chart");
  assert.equal(logged[1].reason.length, 200, "Reasons are capped");
  const written = [];
  activity.attach({ write: chunk => written.push(chunk) });
  assert.deepEqual(written.map(chunk => [chunk.type, chunk.data.type, chunk.transient]), [["data-activity", "gate", true], ["data-activity", "gate", true]]);
}
console.log("PASS: Laya component gate (slices, sidecar client, sidecar pin, activity)");
// Install as app: a folder per app with its own id, scope, icons and offline worker; network use is flagged.
{
  const { artifactPolicy, exportArtifact } = await import("../src/lib/artifact-export.ts");
  const app = await import("../src/lib/app-install.ts");
  const store = await import("../src/lib/app-install-store.ts");
  const { mkdtempSync, readdirSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const digest = "0123456789abcdef0123456789abcdef";

  assert.equal(app.installedAppId("Tip calculator", digest), "tip-calculator-0123456789ab");
  assert.equal(app.installedAppId("Café crème!", digest), "cafe-creme-0123456789ab", "Accents fold to ASCII");
  assert.equal(app.installedAppId("計算機", digest), "app-0123456789ab", "No ASCII letters: a plain id");
  assert.equal(app.installedAppId("../../etc", digest), "etc-0123456789ab", "No path parts in ids");
  for (const title of ["Tip calculator", "計算機", "--x--", "A".repeat(80)]) assert.match(app.installedAppId(title, digest), app.installedAppIdPattern);
  assert.equal(app.installedAppShortName("Tic-tac-toe"), "Tic-tac-toe");
  assert.equal(app.installedAppShortName("Slingshot Garden starter"), "Slingshot");
  assert.equal(app.installedAppShortName("Supercalifragilistic"), "Supercalifra");

  assert.deepEqual(app.networkFeatures("<button id=b>+</button><script>b.onclick = () => b.textContent++</script>"), []);
  assert.deepEqual(app.networkFeatures('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), [], "XML namespaces are not requests");
  assert.deepEqual(app.networkFeatures("<script>fetch('/x'); new WebSocket('wss://live.example.org/s')</script>"), ["fetch", "WebSocket", "live.example.org"]);
  assert.deepEqual(app.networkFeatures('<img src="//cdn.example.net/a.png">'), ["protocol-relative link"]);
  assert.deepEqual(app.networkFeatures('<a href="https://en.wikipedia.org/wiki/Moon">Moon</a>'), ["en.wikipedia.org"]);
  assert.deepEqual(app.networkFeatures("<script>const x = new XMLHttpRequest()</script>"), ["XMLHttpRequest"]);

  const policy = app.installedAppPolicy(artifactPolicy);
  assert.match(policy, /img-src 'self' data:/);
  assert.match(policy, /worker-src 'self'/);
  assert.match(policy, /manifest-src 'self'$/);
  assert.match(policy, /connect-src 'none'/, "The installed page still cannot make requests");
  assert.throws(() => app.installedAppPolicy("default-src 'none'"), /Unexpected/);

  const manifest = JSON.parse(app.installedAppManifest({ id: "tip-calculator-0123456789ab", title: "  Tip   calculator ", network: [] }));
  assert.equal(manifest.id, "/apps/tip-calculator-0123456789ab/");
  assert.equal(manifest.name, "Tip calculator");
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.display, "standalone");
  assert.deepEqual(manifest.icons.map(icon => `${icon.sizes} ${icon.purpose}`), ["192x192 any", "512x512 any", "192x192 maskable", "512x512 maskable"]);
  assert.match(manifest.description, /Works offline/);
  assert.match(JSON.parse(app.installedAppManifest({ id: "x-1", title: "Feed", network: ["fetch"] })).description, /Needs connection: it uses fetch/);

  const worker = app.installedAppWorker("tip-calculator-0123456789ab");
  assert.doesNotThrow(() => new Function(worker), "The worker is valid JavaScript");
  assert.ok(worker.includes('"app-tip-calculator-0123456789ab"') && worker.includes('"icons/icon-maskable-512.png"'));
  assert.ok(!/caches\.delete|caches\.keys/.test(worker), "An app's worker never touches other apps' caches");

  const page = exportArtifact({ title: "Counter", document: "<button>0</button>", policy, head: app.installedAppHead });
  assert.ok(page.includes('<link rel="manifest" href="manifest.webmanifest">') && page.includes('register("sw.js")'));
  assert.ok(page.indexOf("Content-Security-Policy") < page.indexOf('rel="manifest"'), "The policy comes first");

  assert.equal(store.exportOrigin("https://host.example:3216/"), "https://host.example:3216");
  assert.equal(store.exportOrigin("http://127.0.0.1:4000"), "http://127.0.0.1:4000");
  for (const bad of ["", "ftp://h/", "https://h/apps/", "https://u:p@h/", "https://h/?x=1", "not a url"]) assert.equal(store.exportOrigin(bad), undefined, bad);
  assert.match(store.exportsDirectory(""), /Rich AI Chat[/\\]exports$/);
  assert.equal(store.exportsDirectory("/srv/exports"), "/srv/exports");

  const root = mkdtempSync(join(tmpdir(), "rich-chat-install-"));
  try {
    const files = { "index.html": page, "icons/icon-32.png": new Uint8Array([1, 2, 3]) };
    assert.equal(await store.writeInstalledApp(root, "counter-0123456789ab", files), "written");
    assert.equal(readFileSync(join(root, "apps/counter-0123456789ab/index.html"), "utf8"), page);
    assert.deepEqual([...readFileSync(join(root, "apps/counter-0123456789ab/icons/icon-32.png"))], [1, 2, 3]);
    assert.equal(await store.writeInstalledApp(root, "counter-0123456789ab", { "index.html": "other" }), "exists", "Same id, same app: kept");
    assert.equal(readFileSync(join(root, "apps/counter-0123456789ab/index.html"), "utf8"), page);
    assert.deepEqual(readdirSync(join(root, "apps")), ["counter-0123456789ab"], "No half-written folders are left");
    await assert.rejects(store.writeInstalledApp(root, "../escape", files), /Invalid app id/);
    await assert.rejects(store.writeInstalledApp(root, "ok-1", { "../x.html": "x" }), /Invalid file name/);
    await assert.rejects(store.writeInstalledApp(root, "ok-1", { ".hidden": "x" }), /Invalid file name/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// The chat's connection line tells offline, Tailscale off and an unreachable host apart (best effort).
{
  const { checkConnection, classifyConnection, isTailnetHost } = await import("../src/lib/connection.ts");
  assert.equal(isTailnetHost("mac.tail0000.ts.net"), true);
  assert.equal(isTailnetHost("100.101.1.2"), true);
  assert.equal(isTailnetHost("100.200.1.2"), false, "Outside 100.64.0.0/10");
  assert.equal(isTailnetHost("127.0.0.1"), false);
  const tailnet = "mac.tail0000.ts.net";
  assert.equal(classifyConnection({ online: false, status: 200, elapsedMs: 5, hostname: tailnet }), "offline");
  assert.equal(classifyConnection({ online: true, status: 200, elapsedMs: 5, hostname: tailnet }), "online");
  assert.equal(classifyConnection({ online: true, status: 502, elapsedMs: 5, hostname: tailnet }), "unreachable", "Serve answers, the chat server is down");
  assert.equal(classifyConnection({ online: true, elapsedMs: 40, hostname: tailnet }), "tailscale", "The name stopped resolving");
  assert.equal(classifyConnection({ online: true, elapsedMs: 6000, hostname: tailnet }), "unreachable", "Nothing answered in time");
  assert.equal(classifyConnection({ online: true, elapsedMs: 40, hostname: "127.0.0.1" }), "unreachable", "Refused on a local address");

  let clock = 0;
  const now = () => clock;
  const asked = [];
  const answer = status => async (url, init) => { asked.push([url, init.cache]); clock += 10; return new Response(null, { status }); };
  assert.equal(await checkConnection({ fetcher: answer(200), online: true, hostname: tailnet, now }), "online");
  assert.deepEqual(asked[0], ["/api/health", "no-store"]);
  assert.equal(await checkConnection({ fetcher: answer(502), online: true, hostname: tailnet, now }), "unreachable");
  assert.equal(await checkConnection({ fetcher: async () => { clock += 20; throw new TypeError("Failed to fetch"); }, online: true, hostname: tailnet, now }), "tailscale");
  assert.equal(await checkConnection({ fetcher: answer(200), online: false, hostname: tailnet, now }), "offline", "Offline: no request at all");
  assert.equal(asked.length, 2);
  const hang = (_url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => { clock += 6000; reject(new DOMException("aborted", "AbortError")); }));
  assert.equal(await checkConnection({ fetcher: hang, online: true, hostname: tailnet, now, timeoutMs: 20 }), "unreachable", "A host that never answers times out");
}

// The shell worker never answers or caches /api/* and keeps only the page and build files.
{
  const worker = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.match(worker, /url\.pathname\.startsWith\('\/api\/'\)\) return;/, "API requests pass straight through");
  assert.doesNotThrow(() => new Function(worker), "The worker is valid JavaScript");
}

// Pinned cores: every copied file still has the hash recorded when it was pinned (cores.lock.json for visual-core's
// icons, test-core/MANIFEST.json for test-core), so a hand-edited copy fails here. Re-pin with
// scripts/pin-visual-core.mjs or test-core's adopt.py --update instead.
{
  const { createHash } = await import("node:crypto");
  const root = new URL("../", import.meta.url);
  const hash = path => createHash("sha256").update(readFileSync(new URL(path, root))).digest("hex");
  const lock = JSON.parse(readFileSync(new URL("cores.lock.json", root), "utf8"));
  assert.match(lock["gaming-core"].commit, /^[0-9a-f]{40}$/);
  for (const [path, { sha256 }] of Object.entries(lock["gaming-core"].files)) assert.equal(hash(path), sha256);
  assert.match(lock["visual-core"].commit, /^[0-9a-f]{40}$/, "visual-core is pinned to a full commit");
  for (const [path, { sha256 }] of Object.entries(lock["visual-core"].files)) assert.equal(hash(path), sha256, `${path} matches visual-core's pinned copy`);
  const manifest = JSON.parse(readFileSync(new URL(lock["test-core"].manifest, root), "utf8"));
  for (const [path, sha256] of Object.entries(manifest.files)) assert.equal(hash(`test-core/${path}`), sha256, `test-core/${path} matches its manifest`);
  assert.ok("pwa/pwa.mjs" in manifest.files, "test-core's PWA checks are pinned");
  const { kakkoiInlineCss } = await import("../src/generated/kakkoi-inline.ts");
  assert.equal(kakkoiInlineCss, readFileSync(new URL("src/generated/kakkoi-inline.css", root), "utf8"), "The inline subset module matches the pinned CSS");
  const { exportArtifact } = await import("../src/lib/artifact-export.ts");
  const hostStyle = `<style id="kakkoi-inline">${kakkoiInlineCss}</style>`;
  assert.match(readFileSync(new URL("src/lib/host-style.ts", root), "utf8"), /`<style id="kakkoi-inline">\$\{kakkoiInlineCss\}<\/style>`/);
  const exported = exportArtifact({ title: "Probe", head: [hostStyle], document: "<!doctype html><html><head><style>button{color:red}</style></head><body><button>Go</button></body></html>" });
  assert.ok(exported.indexOf(hostStyle) > 0 && exported.indexOf(hostStyle) < exported.indexOf("button{color:red}"), "The host's subset comes before the app's own styles");
}

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { thoughtWatch } from "../src/lib/thought-watch.ts";
import { artifactButtonLabels, artifactFieldLabels, checkArtifact, checkArtifactRequest, readArtifact } from "../src/lib/artifact-checks.ts";
import { chartFromTable } from "../src/lib/table-chart.ts";
import { cloudInstructions } from "../src/lib/cloud-prompt.ts";
import { buildMessage } from "@openuidev/lang-core";
import { Temporal } from "@js-temporal/polyfill";
import { braveSearch, currentDateTime, safeSearchQuery } from "../src/lib/local-tools.ts";
import { applyArtifactEdits, artifactRevision, replaceArtifactScript } from "../src/lib/artifact-edits.ts";
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
const revisionContext = "Revise this mini-app and return a complete new HtmlArtifact.\n\nRequested change or observed behavior: Add one.\n\nArtifact source (JSON string):\n" + JSON.stringify(html);
assert.deepEqual(artifactRevision(buildMessage({ content: "Revision: Add one.", context: ["User clicked", {}, revisionContext] })), {
  request: "Requested change or observed behavior: Add one.", source: html,
});
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

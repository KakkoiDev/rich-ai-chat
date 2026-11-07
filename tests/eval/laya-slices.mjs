// M3 Laya component gate: prompt size per slice, and Laya's accuracy and abstain rate per slice on the synthetic
// labelled sets, asked through the real sidecar exactly as the server asks it. Runs only the Laya classifier (no chat
// model). Without Laya installed it prints the prompt sizes and says the classifier is unavailable.
//   node tests/eval/laya-slices.mjs            prompt sizes, then accuracy on both sets
//   node tests/eval/laya-slices.mjs --sizes    prompt sizes only
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { classroomRules, cloudInstructions, conciseToolPrompt, loadPromptSpec, promptFromSpec } from "../../src/lib/cloud-prompt.ts";
import { gatePlan, promptSlices, sliceAsk, sliceFromOption, sliceSpec } from "../../src/lib/prompt-slices.ts";
import { createLayaGate, layaSidecarLaunch } from "../../src/lib/laya-gate.ts";

const here = new URL(".", import.meta.url).pathname;
const launch = layaSidecarLaunch();

/** Tokens with Laya's own tokenizer (mmBERT uses the Gemma tokenizer), when the runtime is installed. */
function tokenCounts(texts) {
  if ("unavailable" in launch) return undefined;
  const tokenizer = join(launch.args[launch.args.indexOf("--data") + 1], "toolchain", "laya", "model", "tokenizer", "tokenizer.json");
  const code = "import json,sys\nfrom tokenizers import Tokenizer\nt=Tokenizer.from_file(sys.argv[1])\n" +
    "print(json.dumps([len(t.encode(x,add_special_tokens=False).ids) for x in json.load(sys.stdin)]))";
  const run = spawnSync(launch.command, ["-I", "-c", code, tokenizer], { input: JSON.stringify(texts), encoding: "utf8", env: launch.env });
  return run.status === 0 ? JSON.parse(run.stdout) : undefined;
}

const spec = loadPromptSpec();
const prompts = [
  ["full (today's rich path)", cloudInstructions(classroomRules)],
  ["concise (text, sources)", conciseToolPrompt],
  ...promptSlices.filter(slice => gatePlan({ outcome: "chosen", option: sliceAsk("").options[promptSlices.indexOf(slice)], elapsedMs: 0 }).prompt === "sliced")
    .map(slice => [slice, promptFromSpec(sliceSpec(spec, [slice]), classroomRules)]),
];
const tokens = tokenCounts(prompts.map(([, text]) => text));
const full = tokens?.[0] ?? prompts[0][1].length;
console.log("| Prompt | Characters | Tokens | Share of full |\n|---|---:|---:|---:|");
prompts.forEach(([name, text], i) => {
  const size = tokens?.[i] ?? text.length;
  console.log(`| ${name} | ${text.length.toLocaleString("en")} | ${tokens ? tokens[i].toLocaleString("en") : "n/a"} | ${Math.round(size / full * 100)}% |`);
});
if (!tokens) console.log("(Token counts need the Laya runtime; shares are by characters.)");
if (process.argv.includes("--sizes")) process.exit(0);

const gate = createLayaGate({ launch: () => launch, timeoutMs: 120000 });
async function measure(file) {
  const { cases } = JSON.parse(readFileSync(join(here, file), "utf8"));
  const rows = [];
  for (const { text, slice, lang } of cases) {
    const decision = await gate.ask(sliceAsk(text));
    if (decision.outcome === "unavailable") return { unavailable: decision.reason };
    rows.push({ slice, lang, decision, chosen: sliceFromOption(decision.option) });
  }
  return { rows };
}

function table(title, rows) {
  const groups = [...promptSlices.map(slice => [slice, rows.filter(row => row.slice === slice)]),
    ["English", rows.filter(row => row.lang === "en")], ["Japanese", rows.filter(row => row.lang === "ja")], ["All", rows]];
  console.log(`\n${title}\n\n| Slice | Cases | Answered | Correct / answered | Abstained | Wrong answers |\n|---|---:|---:|---:|---:|---|`);
  for (const [name, group] of groups) {
    const answered = group.filter(row => row.decision.outcome === "chosen");
    const correct = answered.filter(row => row.chosen === row.slice).length;
    const wrong = name === "All" || name === "English" || name === "Japanese" ? "" :
      answered.filter(row => row.chosen !== row.slice).map(row => `${row.chosen} (${row.decision.confidence})`).join(", ");
    const pct = (n, d) => d ? `${(n / d * 100).toFixed(1)}%` : "n/a";
    console.log(`| ${name} | ${group.length} | ${answered.length} | ${correct} / ${answered.length} (${pct(correct, answered.length)}) | ${group.length - answered.length} (${pct(group.length - answered.length, group.length)}) | ${wrong} |`);
  }
  const other = rows.filter(row => !["chosen", "abstained"].includes(row.decision.outcome));
  if (other.length) console.log(`(${other.length} questions timed out or failed)`);
  const times = rows.map(row => row.decision.elapsedMs).sort((a, b) => a - b);
  console.log(`Round trip through the sidecar: median ${times[Math.floor(times.length / 2)]} ms, 95th percentile ${times[Math.floor(times.length * 0.95)]} ms.`);
}

try {
  for (const [title, file] of [["Development set (wording chosen on it)", "laya-slices.json"], ["Held-out set", "laya-slices-heldout.json"]]) {
    const result = await measure(file);
    if (result.unavailable) { console.log(`\nLaya is unavailable (${result.unavailable}); no accuracy measured.`); break; }
    table(title, result.rows);
  }
} finally {
  gate.stop();
}

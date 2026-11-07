// A stand-in for scripts/laya-sidecar.py that speaks the same JSON lines, for deterministic tests:
//   node tests/stubs/laya-sidecar.mjs <mode>
// answer        greets, then answers "chart_or_graph" at .995, or abstains when the message mentions "unsure"
// silent        greets, then never answers
// not-installed greets with installed: false
// crash         greets, answers once, then exits
// mute          never greets
import { createInterface } from "node:readline";

const mode = process.argv[2] ?? "answer";
const send = value => process.stdout.write(JSON.stringify(value) + "\n");
if (mode !== "mute") send({ ready: true, installed: mode !== "not-installed", pinned: true });
let answered = 0;
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (mode === "silent" || mode === "mute") continue;
  if (mode === "not-installed") { send({ id: request.id, unavailable: true, reason: "not-installed" }); continue; }
  if (request.warm) { send({ id: request.id, warm: true, ms: 1 }); continue; }
  const unsure = /unsure/.test(request.state?.message ?? "");
  send(unsure ? { id: request.id, answer: null, confidence: 0.61, abstained: true, ms: 2 }
    : { id: request.id, answer: "chart_or_graph", confidence: 0.995, abstained: false, ms: 2 });
  if (mode === "crash" && ++answered === 1) process.exit(1);
}

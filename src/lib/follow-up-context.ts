import { searchSummaryText } from "./visible-reply.ts";

type TurnMessage = { role: "user" | "assistant"; content: string };
const words = (text: string) => new Set(text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []);
const cap = (text: string, limit: number) => text.length <= limit ? text : text.slice(0, limit - 1) + "…";

/** Retain compact, verbatim evidence from earlier answers when full turns do not fit the prompt. */
export function earlierAnswerContext(messages: TurnMessage[], retained: TurnMessage[], request: string) {
  if (!/\b(?:again|earlier|previous|last|same|those|that|it|findings|summary|summari[sz]e|update|revise|change|shorter|longer|instead|correction)\b|前の|さっき|修正|要約/i.test(request)) return "";
  const kept = new Set(retained);
  const terms = words(request);
  const candidates: { request: string; answer: string; index: number; score: number }[] = [];
  let question = "";
  for (const [index, message] of messages.entries()) {
    if (message.role === "user") { question = message.content; continue; }
    if (!question || kept.has(message)) continue;
    let answer = "";
    try {
      answer = searchSummaryText(message.content);
    } catch { continue; }
    if (!answer) continue;
    const matches = [...words(question + " " + answer)].filter(term => terms.has(term)).length;
    candidates.push({ request: cap(question, 280), answer: cap(answer, 950), index, score: matches });
  }
  const chosen = candidates.sort((a, b) => b.score - a.score || b.index - a.index).slice(0, 2)
    .sort((a, b) => a.index - b.index).map(({ request, answer }) => ({ request, answer }));
  return chosen.length ? JSON.stringify(chosen) : "";
}

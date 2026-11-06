/** Separate an explicit text transformation from the quoted text it operates on. */
export function quotedTransform(request: string) {
  if (request.length > 5000) return;
  const match = /^([^"“«\n]{1,350}):\s*(?:"([^"]+)"|“([^”]+)”|«([^»]+)»)\s*[.!?]?\s*$/.exec(request.trim());
  if (!match) return;
  const [, instruction, ...quoted] = match;
  if (!/\b(?:extract|translate|summari[sz]e|rewrite|paraphrase)\b/i.test(instruction)
    || !/\b(?:quoted|quote|following)\b/i.test(instruction)) return;
  // The transformation path cannot perform external work, even if a quote asks it to.
  const intent = instruction.replace(/^\s*(?:do not|don[’']t|never)\s+(?:search|browse|look up)[^.?!]*[.?!]\s*/i, "");
  if (/\b(?:search|browse|look up|verify online)\b/i.test(intent)) return;
  const text = quoted.find(value => value !== undefined)?.trim();
  if (text) return { instruction: intent.trim(), text };
}

import { parseMessage } from "@openuidev/lang-core";

const revisionPrefix = "Revise this mini-app and return a complete new HtmlArtifact.";
const sourceMarker = "\n\nArtifact source (JSON string):\n";

/** Read the context carried by the real OpenUI revision action. */
export function artifactRevision(message: string) {
  const { context } = parseMessage(message);
  const wrapped = Array.isArray(context) ? context.findLast((part: unknown) =>
    typeof part === "string" && part.startsWith(revisionPrefix)) : undefined;
  const text = typeof wrapped === "string" ? wrapped : message;
  if (!text.startsWith(revisionPrefix)) return undefined;
  const sourceAt = text.lastIndexOf(sourceMarker);
  if (sourceAt < 0) return undefined;
  const requestAt = text.indexOf("Requested change or observed behavior:");
  const request = text.slice(Math.max(0, requestAt), sourceAt);
  try {
    const source: unknown = JSON.parse(text.slice(sourceAt + sourceMarker.length));
    return { request, source: typeof source === "string" ? source : undefined };
  } catch {
    return { request, source: undefined };
  }
}

type Replacement = { find: string; replace: string };

/** Apply model edits atomically against the original, without fuzzy matches. */
export function applyArtifactEdits(source: string, edits: Replacement[]) {
  if (!edits.length || edits.length > 6) return undefined;
  const ranges: { start: number; end: number; text: string }[] = [];
  for (const { find, replace } of edits) {
    if (!find || find === replace) return undefined;
    const start = source.indexOf(find);
    if (start < 0 || source.indexOf(find, start + 1) >= 0) return undefined;
    ranges.push({ start, end: start + find.length, text: replace });
  }
  ranges.sort((a, b) => b.start - a.start);
  let result = source;
  let boundary = source.length;
  for (const { start, end, text } of ranges) {
    if (end > boundary) return undefined;
    result = result.slice(0, start) + text + result.slice(end);
    boundary = start;
  }
  return /^(?:<!doctype html>\s*)?<html(?:\s[^>]*)?>/i.test(result.trim())
    ? result.trim()
    : `<!doctype html><html><head><title>Revised preview</title></head><body>${result}</body></html>`;
}

/** Replace one inline script without rewriting the working HTML. */
export function replaceArtifactScript(source: string, answer: string) {
  const scripts = [...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
  if (scripts.length !== 1 || /\b(?:src|type)\s*=/i.test(scripts[0][1])) return undefined;
  const script = answer.trim().replace(/^```(?:javascript|js)?\s*([\s\S]*?)\s*```$/i, "$1").trim();
  if (!script || /<\/?script\b|<!doctype|<html\b/i.test(script)) return undefined;
  return applyArtifactEdits(source, [{ find: scripts[0][0], replace: `<script>\n${script}\n</script>` }]);
}

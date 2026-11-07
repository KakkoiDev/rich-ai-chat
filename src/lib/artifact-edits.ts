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

const buttonPattern = /(<button\b[^>]*>)([\s\S]*?)(<\/button\s*>)/gi;
const buttonText = (inner: string) => inner.replace(/<[^>]*>/g, "").trim();

/**
 * A revision that adds the requested button but words its label differently ("-1" for "Minus 1") keeps its behavior
 * and gets the requested label. Only when exactly one requested label is missing and exactly one button is new, so
 * nothing is guessed: otherwise undefined, and the draft is rejected as before.
 */
export function relabelNewButton(original: string, draft: string, requested: string[]) {
  const before = new Set([...original.matchAll(buttonPattern)].map(match => buttonText(match[2])));
  const buttons = [...draft.matchAll(buttonPattern)];
  const present = new Set(buttons.map(match => buttonText(match[2])));
  const missing = requested.filter(label => !present.has(label));
  const added = buttons.filter(match => !before.has(buttonText(match[2])) && !requested.includes(buttonText(match[2])));
  if (missing.length !== 1 || added.length !== 1) return undefined;
  const [match] = added;
  const label = missing[0].replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
  // An aria-label would still announce the old wording, so it goes.
  const open = match[1].replace(/\s+aria-label\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, "");
  return draft.slice(0, match.index) + open + label + match[3] + draft.slice(match.index! + match[0].length);
}

/**
 * Markup that ended early: drop stray closing script tags and close elements left open, innermost first, so the
 * controls are complete before a script is added. Void elements need no closing tag.
 */
export function closeMarkup(markup: string) {
  const cleaned = markup.replace(/<\/script\s*>/gi, "").trimEnd();
  const open: string[] = [];
  const voids = /^(?:area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/i;
  for (const [, closing, name, selfClosing] of cleaned.matchAll(/<(\/?)([a-z][a-z0-9-]*)\b[^>]*?(\/?)>/gi)) {
    if (voids.test(name) || selfClosing) continue;
    if (!closing) open.push(name.toLowerCase());
    else {
      const at = open.lastIndexOf(name.toLowerCase());
      if (at >= 0) open.splice(at);
    }
  }
  return cleaned + open.reverse().map(name => `</${name}>`).join("");
}

/**
 * Buttons a model left unclosed ("Reset all</br><script>…"): close each before the next button, script or container
 * end, dropping a stray closing tag right after its label. Used only when it turns a rejected draft into one that
 * passes every check.
 */
export function closeButtons(html: string) {
  let out = "";
  let from = 0;
  const open = /<button\b[^>]*>/gi;
  for (let match = open.exec(html); match; match = open.exec(html)) {
    const start = match.index + match[0].length;
    const next = /<\/button\s*>|<button\b|<script\b|<\/(?:body|main|div|form|section|p|li)\s*>/gi;
    next.lastIndex = start;
    const found = next.exec(html);
    if (found && /^<\/button/i.test(found[0])) continue;
    const end = found ? found.index : html.length;
    out += html.slice(from, start) + html.slice(start, end).replace(/<\/(?:script|br)\s*>\s*$/i, "") + "</button>";
    from = end;
    open.lastIndex = end;
  }
  return out + html.slice(from);
}

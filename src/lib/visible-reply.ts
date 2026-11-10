import { createParser, type ElementNode } from "@openuidev/lang-core";
import spec from "../generated/spec.json" with { type: "json" };

const emptyReply = "The model finished without an answer it could display. Please try again.";
const markdown = (text: string) => `root = Card([MarkDownRenderer(${JSON.stringify(text)})])`;
const parser = createParser(spec.schema);
const markup = /(?:^|\n)\s*root\s*=|^\s*```openui(?:-lang)?\b/im;
const hasText = (value: string) => /[^\s\p{Cf}]/u.test(value);
const containers = new Set(["Card", "Stack", "Buttons"]);
const textElements = new Set(["TextContent", "MarkDownRenderer", "CardHeader", "TextCallout", "Callout"]);

function hasContent(node: ElementNode): boolean {
  if (containers.has(node.typeName)) {
    return Object.values(node.props).flat().some(value => value && typeof value === "object"
      && "type" in value && value.type === "element" && hasContent(value as ElementNode));
  }
  if (textElements.has(node.typeName)) return Object.entries(node.props).some(([key, value]) =>
    !["variant", "align", "tone", "size"].includes(key) && typeof value === "string" && hasText(value));
  return true;
}

/** Preserve rich replies; never send plain Markdown into a renderer that only displays OpenUI. */
export function visibleModelReply(answer: string): { markup: string; valid: boolean } {
  if (!hasText(answer)) return { markup: markdown(emptyReply), valid: false };
  if (!markup.test(answer)) return { markup: markdown(answer), valid: true };
  try {
    const parsed = parser.parse(answer);
    if (!parsed.meta.incomplete && (parsed.root && hasContent(parsed.root) || parsed.rootExpression)) {
      return { markup: answer, valid: true };
    }
    // Keep recoverable prose from a mixed reply without presenting a broken UI program as the answer.
    const boundary = answer.search(markup);
    const prose = answer.slice(0, boundary).trim();
    if (hasText(prose)) return { markup: markdown(prose), valid: true };
  } catch {
    // The model can retry with a simpler response when the parser rejects the result.
  }
  return { markup: markdown(emptyReply), valid: false };
}

/** Host-generated custom components and saved interactive state must be preserved on reload. */
export function restoreVisibleReply(answer: string) {
  if (markup.test(answer) || /\]\]>openui:|^<content\b/.test(answer)) return answer;
  return visibleModelReply(answer).markup;
}

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

/** Search synthesis can return prose or one or more prose components despite the text-only prompt. */
export function searchSummaryText(answer: string): string {
  if (!hasText(answer)) return "";
  if (!markup.test(answer)) return answer.trim();
  const result = parser.parse(answer);
  if (result.meta.incomplete || !result.root) return "";
  const prose: string[] = [];
  const visit = (node: ElementNode) => {
    const value = node.typeName === "MarkDownRenderer" ? node.props.textMarkdown
      : node.typeName === "TextContent" ? node.props.text : undefined;
    if (typeof value === "string" && hasText(value)) prose.push(value.trim());
    for (const child of Object.values(node.props).flat()) {
      if (child && typeof child === "object" && "type" in child && child.type === "element") visit(child as ElementNode);
    }
  };
  visit(result.root);
  return prose.join("\n\n");
}

export function mapFromReply(answer: string) {
  if (!answer.includes("OpenStreetMap(")) return;
  let root;
  try { root = parser.parse(answer).root; } catch { return; }
  if (root?.typeName !== "Card" || !Array.isArray(root.props.children)) return;
  const map = root.props.children.find((child): child is ElementNode =>
    child && typeof child === "object" && child.type === "element" && child.typeName === "OpenStreetMap");
  if (!map) return;
  const { label, west, south, east, north } = map.props;
  if (typeof label !== "string" || typeof west !== "number" || typeof south !== "number"
    || typeof east !== "number" || typeof north !== "number"
    || !(west >= -180 && east <= 180 && west < east && south >= -85 && north <= 85 && south < north)) return;
  const links = root.props.children.find((child): child is ElementNode =>
    child && typeof child === "object" && child.type === "element" && child.typeName === "MarkDownRenderer");
  const osm = typeof links?.props.textMarkdown === "string"
    ? /<https:\/\/www\.openstreetmap\.org\/search\?([^<>]+)>/.exec(links.props.textMarkdown) : null;
  const place = osm ? new URLSearchParams(osm[1]).get("query") ?? undefined : undefined;
  return { label, place, bounds: [west, south, east, north] as [number, number, number, number] };
}

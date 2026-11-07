import type { PromptSpec } from "@/lib/cloud-prompt";

/**
 * Component slices of the OpenUI prompt (roadmap M3). Small local models do better with only the components a
 * request needs, so the Laya gate (laya-gate.ts) picks one slice and the prompt carries the always-present base
 * components plus that slice's components, notes, examples and rules. "text" and "sources" are answered in plain
 * Markdown with the concise tool prompt, exactly as small Gemma models are answered today without rich UI.
 */
export const promptSlices = ["text", "sources", "chart", "table", "form", "layout", "media", "app"] as const;
export type PromptSlice = typeof promptSlices[number];
export const markdownSlices: readonly PromptSlice[] = ["text", "sources"];

/**
 * What Laya is asked, and the options it chooses between. Descriptive option names were measured against bare slice
 * names on tests/eval/laya-slices.json (see docs/BENCHMARK-PLAN.md); the wording and threshold are frozen there.
 */
export const sliceQuestion = "Which kind of reply does the request need?";
export const sliceOptions: Record<PromptSlice, string> = {
  text: "explanation_in_words",
  sources: "current_facts_from_the_web",
  chart: "chart_or_graph",
  table: "table",
  form: "form_to_fill_in",
  layout: "tabs_accordion_steps_or_cards",
  media: "photos_or_videos",
  app: "interactive_app_or_game",
};
export const sliceMinConfidence = 0.99;

/** The one typed question the gate asks about a request. A request longer than Laya's context makes it abstain. */
export function sliceAsk(request: string) {
  return {
    kind: "choice" as const,
    state: { message: request.slice(0, 4000) },
    question: sliceQuestion,
    options: promptSlices.map(slice => sliceOptions[slice]),
    minConfidence: sliceMinConfidence,
  };
}

export function sliceFromOption(option: unknown): PromptSlice | undefined {
  return promptSlices.find(slice => sliceOptions[slice] === option);
}

/** Every sliced prompt can lay out a card of text. */
export const baseComponents = ["Stack", "Card", "CardHeader", "TextContent", "MarkDownRenderer", "Callout"] as const;

export const sliceComponents: Record<PromptSlice, readonly string[]> = {
  text: ["TextCallout", "InlineHeader", "CodeBlock"],
  sources: ["ListBlock", "ListItem", "TagBlock", "Tag"],
  chart: ["BarChart", "LineChart", "AreaChart", "RadarChart", "HorizontalBarChart", "Series", "PieChart", "RadialChart",
    "SingleStackedBarChart", "Slice", "ScatterChart", "ScatterSeries", "Point"],
  table: ["Table", "Col", "EditableTable"],
  form: ["Form", "FormControl", "Label", "Input", "TextArea", "Select", "SelectItem", "DatePicker", "Slider", "CheckBoxGroup",
    "CheckBoxItem", "RadioGroup", "RadioItem", "SwitchGroup", "SwitchItem", "Chips", "ChipItem", "OptionCards", "OptionCard",
    "Button", "Buttons", "IconButton"],
  layout: ["Tabs", "TabItem", "Accordion", "AccordionItem", "Steps", "StepsItem", "Carousel", "Separator", "Modal", "InlineHeader",
    "SnippetCardBlock", "SnippetCardItem", "OverviewCardBlock", "OverviewCardItem", "ContextCardBlock", "ContextCardItem",
    "CompositeCardBlock", "CompositeCardItem", "VisualCardBlock", "VisualCardItem", "Text", "BoldText", "IconText", "ImageText",
    "ImageTextLarge", "MetricIndicatorInline", "MetricIndicatorWithStrikethrough", "TagBlock", "Tag", "Icon", "EntityList",
    "ListBlock", "ListItem"],
  media: ["Image", "ImageBlock", "ImageGallery", "Carousel"],
  app: ["HtmlArtifact"],
};

const identifiers = (text: string) => new Set(text.match(/\b[A-Z][A-Za-z0-9]*\b/g) ?? []);

/**
 * The library spec cut down to the base components plus the slices': only their signatures, the notes of groups
 * they fully cover (and the base Content group), the examples that use nothing else, and the rules whose first named
 * component is theirs. Rules naming no component at all (e.g. "generate realistic data") always stay.
 */
export function sliceSpec(spec: PromptSpec, slices: readonly PromptSlice[]): PromptSpec {
  const known = new Set(Object.keys(spec.components));
  const base = new Set<string>(baseComponents.filter(name => known.has(name)));
  const chosen = new Set(slices.flatMap(slice => sliceComponents[slice]).filter(name => known.has(name) && !base.has(name)));
  const allowed = new Set([...base, ...chosen]);
  const components = Object.fromEntries(Object.entries(spec.components).filter(([name]) => allowed.has(name)));
  const componentGroups = spec.componentGroups
    ?.map(group => {
      const present = group.components.filter(name => known.has(name));
      const kept = present.filter(name => allowed.has(name));
      const covered = kept.length === present.length || group.name === "Content";
      return { ...group, components: kept, notes: covered ? group.notes : undefined };
    })
    .filter(group => group.components.length);
  // Rules about submitting and resetting forms name no component, so they would otherwise ride along with every slice.
  const mentions = (text: string) => [...identifiers(text), ...(/\bforms?\b|@Reset|@Run\b/i.test(text) ? ["Form"] : [])]
    .filter(name => known.has(name));
  const examples = spec.promptOptions?.examples?.filter(example => {
    const used = [...(example.match(/\b([A-Z][A-Za-z0-9]*)\(/g) ?? [])].map(call => call.slice(0, -1)).filter(name => known.has(name));
    return used.length > 0 && used.every(name => allowed.has(name));
  });
  // A rule belongs to the first component it names ("Use native charts … not HtmlArtifact" is a chart rule).
  const additionalRules = spec.promptOptions?.additionalRules?.filter(rule => {
    const [owner] = mentions(rule).filter(name => !base.has(name));
    return !owner || chosen.has(owner);
  });
  return { ...spec, components, componentGroups, promptOptions: { ...spec.promptOptions, examples, additionalRules } };
}

/** What the Laya sidecar said about one request (laya-gate.ts). Never carries request text. */
export type GateDecision = {
  outcome: "chosen" | "abstained" | "unavailable" | "timeout" | "error";
  /** The option Laya chose; set only when it answered above the threshold. */
  option?: string;
  confidence?: number;
  elapsedMs: number;
  reason?: string;
};
export type GatePrompt = "concise" | "sliced" | "general";

/**
 * Which prompt a decision leads to. Only a confident answer naming a known slice changes anything: "text" and
 * "sources" get the concise Markdown prompt, the rich slices get a sliced OpenUI prompt. Abstaining, a timeout, an
 * error or a missing sidecar keep the general path exactly as it is without the gate.
 */
export function gatePlan(decision: GateDecision): { prompt: GatePrompt; slices: PromptSlice[] } {
  const slice = decision.outcome === "chosen" ? sliceFromOption(decision.option) : undefined;
  if (!slice) return { prompt: "general", slices: [] };
  return { prompt: markdownSlices.includes(slice) ? "concise" : "sliced", slices: [slice] };
}

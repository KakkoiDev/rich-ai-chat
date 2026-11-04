/**
 * Entry point for the OpenUI CLI spec generator.
 *
 * `pnpm generate` runs `openui generate src/library.ts --spec`, which bundles
 * this file (stubbing asset imports) and reads the `library` + `promptOptions`
 * exports to write `src/generated/spec.json`.
 */
import { ColorPieChart } from "./pie-chart";
import { HtmlArtifact } from "./html-artifact";
import { openuiLibrary, openuiPromptOptions } from "@openuidev/react-ui/genui-lib";

export const library = openuiLibrary.extend({
  components: { override: [ColorPieChart], add: [{ component: HtmlArtifact, slots: ["Card.children"] }] },
});

/**
 * The library's prompt options plus two form rules. Without them, a request
 * like "when I submit, show a summary" gets a pre-written summary revealed
 * locally, so the user's entries never reach the assistant, and fields that
 * should appear for a certain answer are never wired up.
 */
export const promptOptions = {
  ...openuiPromptOptions,
  additionalRules: [
    ...(openuiPromptOptions.additionalRules ?? []),
    "Use native charts for charts and chart revisions. For a request to change pie slice colors, reuse the previous labels and values with PieChart; distinct colors are built in. Do not turn a chart correction into HtmlArtifact.",
    `When asked to build or revise an interactive app or game, always use root = Card([HtmlArtifact(...)]) directly; never use Stack as the root for artifacts. Example: root = Card([HtmlArtifact("Counter", "<button id='b'>0</button><script>document.getElementById('b').onclick=e=>e.target.textContent=+e.target.textContent+1</script>")]). Prefer exactly two arguments: title and one HTML string containing its CSS and JavaScript. If separating JavaScript, the optional third argument is JavaScript only; put CSS in a style tag in the HTML string. Use single quotes inside HTML attributes and JavaScript so the OpenUI string needs no escaped quotes. Keep it compact and self-contained. Implement controls and state locally, never with @ToAssistant. No external assets, fetch, storage, libraries, eval, or Function constructor. For calculators, implement operations with explicit arithmetic. For games, use the same geometry for rendering and collision detection, make pointer controls work before keyboard focus, and use elapsed time or a fixed timestep for animation.`,
    'A Form\'s submit button must send the entries to you: its action must be @ToAssistant(...), e.g. Button("Plan my trip", @ToAssistant("Plan my trip"), "primary"), never @Set or another local-only action. Don\'t put what the form produces (a summary, plan or itinerary) in the same reply, hidden or not; write it in your next reply from the values the user submitted.',
    'When a field should only appear for a certain answer (e.g. a company name only for Business trips), bind the deciding field to a $variable with its value argument, e.g. RadioGroup("tripType", items, "Leisure", { required: true }, $tripType), and show the field with $tripType == "Business" ? companyField : null.',
  ],
};

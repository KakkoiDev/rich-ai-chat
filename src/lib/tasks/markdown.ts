import type { Change, Plan } from "./store";

/**
 * The plan as Markdown, for export: the objective, each todo as a checkbox with its status and evidence, the
 * checkpoints, and the change log. Pure and byte-stable for the same input. Titles and notes are escaped so a todo
 * cannot inject headings or links that look like the app's own.
 */
const escape = (value: string) => value.replace(/([\\`*_[\]#<>|])/g, "\\$1");
const statusLabel: Record<string, string> = {
  pending: "to do", in_progress: "in progress", blocked: "blocked", done: "done", cancelled: "cancelled",
};

export function planMarkdown(plan: Plan, changes: Change[] = []) {
  const titles = new Map(plan.items.map(item => [item.id, item.title]));
  const lines = [`# ${escape(plan.task.objective)}`, "", `Task \`${plan.task.id}\` · version ${plan.task.version} · updated ${plan.task.updatedAt}`, "", "## Todos", ""];
  if (!plan.items.length) lines.push("_No todos yet._");
  for (const item of plan.items) {
    lines.push(`- [${item.status === "done" ? "x" : " "}] ${escape(item.title)} — ${statusLabel[item.status]}`
      + (item.dependsOn ? ` (after: ${escape(titles.get(item.dependsOn) ?? item.dependsOn)})` : "")
      + (item.blockedReason ? ` (blocked: ${escape(item.blockedReason)})` : ""));
    for (const evidence of item.evidence) lines.push(`  - evidence: ${evidence.kind} \`${evidence.ref.replace(/`/g, "'")}\``);
  }
  lines.push("", "## Checkpoints", "");
  if (!plan.checkpoints.length) lines.push("_No checkpoints yet._");
  for (const checkpoint of plan.checkpoints)
    lines.push(`- ${checkpoint.createdAt} (${checkpoint.actor})`
      + (checkpoint.itemId ? ` on “${escape(titles.get(checkpoint.itemId) ?? checkpoint.itemId)}”` : "")
      + `: ${escape(checkpoint.note)}`);
  if (changes.length) {
    lines.push("", "## Change log", "");
    for (const change of changes)
      lines.push(`${change.seq}. ${change.at} ${change.actor} ${change.action} ${change.entity}`
        + ("to" in change.data && "from" in change.data ? ` (${escape(String(change.data.from))} → ${escape(String(change.data.to))})` : ""));
  }
  return lines.join("\n") + "\n";
}

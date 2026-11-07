import { connection } from "next/server";
import { planMarkdown } from "@/lib/tasks/markdown";
import { requestProfile, taskServices } from "@/lib/tasks/server";

/** The chat's plan as a Markdown file: objective, todos with evidence, checkpoints and the change log. */
export async function GET(req: Request) {
  await connection();
  if (req.headers.get("sec-fetch-site") === "cross-site") return new Response(null, { status: 403 });
  const profileId = requestProfile(req);
  const chatId = new URL(req.url).searchParams.get("chat") ?? "";
  if (!profileId || !chatId || chatId.length > 100) return new Response("Name the chat and the browser profile", { status: 400 });
  const { store } = taskServices();
  const plan = store.readPlan(profileId, chatId);
  if (!plan) return new Response("This chat has no plan", { status: 404 });
  const slug = plan.task.objective.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "plan";
  return new Response(planMarkdown(plan, store.changes(profileId, plan.task.id)), {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="${slug}.md"`,
      "cache-control": "no-store",
    },
  });
}

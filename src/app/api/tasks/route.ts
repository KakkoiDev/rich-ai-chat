import { connection } from "next/server";
import { z } from "zod";
import { chatModelIds } from "@/lib/chat-models";
import { requestProfile, taskServices } from "@/lib/tasks/server";
import { itemEvents, PlanError, type ItemEvent } from "@/lib/tasks/store";

/**
 * The Tasks panel's API. Every call is scoped to the browser profile the panel sends (no accounts): another profile's
 * tasks, items and jobs answer 404. Writes carry the version the panel displayed, so a concurrent edit is refused
 * with 409 instead of being overwritten. Responses hold the chat's refreshed plan and jobs.
 */

const chat = z.string().trim().min(1).max(100);
const id = z.string().min(1).max(80);
const version = z.number().int().positive().optional();
const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("open"), chat, objective: z.string().max(500) }),
  z.object({ action: z.literal("objective"), chat, taskId: id, objective: z.string().max(500), version }),
  z.object({ action: z.literal("add"), chat, title: z.string().max(200), afterPrevious: z.boolean().optional() }),
  z.object({ action: z.literal("edit"), chat, itemId: id, title: z.string().max(200), version }),
  z.object({
    action: z.literal("event"), chat, itemId: id, event: z.enum(itemEvents as [ItemEvent, ...ItemEvent[]]), version,
    reason: z.string().max(300).optional(),
    evidence: z.array(z.object({ kind: z.string().max(20), ref: z.string().max(300) })).max(5).optional(),
  }),
  z.object({ action: z.literal("checkpoint"), chat, taskId: id, note: z.string().max(1000), itemId: id.optional() }),
  z.object({
    action: z.literal("queue-job"), chat, title: z.string().max(160), steps: z.array(z.string().max(2000)).max(8),
    model: z.enum([...chatModelIds, "server-default"]), itemId: id.optional(), dependsOn: id.optional(),
  }),
  z.object({ action: z.literal("cancel-job"), chat, jobId: id }),
]);

function forbidden(req: Request) {
  return req.headers.get("sec-fetch-site") === "cross-site";
}

function snapshot(profileId: string, chatId: string) {
  const { store, jobs } = taskServices();
  const plan = store.readPlan(profileId, chatId);
  return { plan, jobs: plan ? jobs.forTask(profileId, plan.task.id) : [] };
}

export async function GET(req: Request) {
  await connection();
  if (forbidden(req)) return new Response(null, { status: 403 });
  const profileId = requestProfile(req);
  const chatId = chat.safeParse(new URL(req.url).searchParams.get("chat"));
  if (!profileId) return Response.json({ error: "This browser has no profile id" }, { status: 400 });
  if (!chatId.success) return Response.json({ error: "Name the chat" }, { status: 400 });
  return Response.json(snapshot(profileId, chatId.data));
}

export async function POST(req: Request) {
  await connection();
  if (forbidden(req)) return new Response(null, { status: 403 });
  const profileId = requestProfile(req);
  if (!profileId) return Response.json({ error: "This browser has no profile id" }, { status: 400 });
  const parsed = action.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid task request" }, { status: 400 });
  const input = parsed.data;
  const { store, jobs } = taskServices();
  try {
    switch (input.action) {
      case "open": store.openTask(profileId, input.chat, input.objective, "user"); break;
      case "objective": store.setObjective(profileId, input.taskId, input.objective, input.version, "user"); break;
      case "add": store.addItems(profileId, input.chat, { titles: [input.title], dependsOnPrevious: input.afterPrevious }, "user"); break;
      case "edit": store.editItem(profileId, input.itemId, input.title, input.version, "user"); break;
      case "event":
        store.changeItem(profileId, input.itemId, input.event, { expectedVersion: input.version, reason: input.reason, evidence: input.evidence }, "user");
        break;
      case "checkpoint": store.recordCheckpoint(profileId, input.taskId, { itemId: input.itemId, note: input.note }, "user"); break;
      case "queue-job":
        jobs.enqueue(profileId, input.chat, { title: input.title, steps: input.steps, model: input.model, itemId: input.itemId, dependsOn: input.dependsOn }, "user");
        break;
      case "cancel-job": jobs.cancel(profileId, input.jobId, "user"); break;
    }
  } catch (error) {
    if (error instanceof PlanError) return Response.json({ error: error.message, ...snapshot(profileId, input.chat) }, { status: error.status });
    throw error;
  }
  return Response.json(snapshot(profileId, input.chat));
}

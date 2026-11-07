import { createJobs, type Jobs } from "@/lib/tasks/jobs";
import { createTaskStore, validProfileId, type TaskStore } from "@/lib/tasks/store";

/** One store per server process (kept on globalThis so development reloads do not open a connection per edit). */
const shared = globalThis as typeof globalThis & { richChatTasks?: { store: TaskStore; jobs: Jobs } };

export function taskServices() {
  if (!shared.richChatTasks) {
    const store = createTaskStore();
    shared.richChatTasks = { store, jobs: createJobs(store) };
  }
  return shared.richChatTasks;
}

export const profileHeader = "x-rich-chat-profile";

/** The browser profile of a request: the header the chat and the Tasks panel send. Never a cookie (see browser-profile.ts). */
export function requestProfile(req: Request): string | undefined {
  const header = req.headers.get(profileHeader);
  return validProfileId(header) ? header : undefined;
}

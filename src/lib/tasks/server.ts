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

export const profileCookie = "rich_chat_profile";
export const profileHeader = "x-rich-chat-profile";

/** The browser profile of a request: the header the Tasks panel sends, else the cookie it sets for the chat route. */
export function requestProfile(req: Request): string | undefined {
  const header = req.headers.get(profileHeader);
  if (validProfileId(header)) return header;
  const cookie = (req.headers.get("cookie") ?? "").split(/;\s*/).find(part => part.startsWith(profileCookie + "="));
  const value = cookie ? decodeURIComponent(cookie.slice(profileCookie.length + 1)) : undefined;
  return validProfileId(value) ? value : undefined;
}

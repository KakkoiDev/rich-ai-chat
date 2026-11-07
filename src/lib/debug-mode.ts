/**
 * "Debug this chat": which chats in this browser send their requests in debug mode, so the server records full text
 * (the message, prompts, tool input and output, drafts) in that chat's Activity and in its 7-day debug file. Off by
 * default and per chat. A new chat has no id until its first message, so the switch is held until then.
 */
const key = "rich-ai-chat:debug-threads";
const changed = "rich-ai-chat:debug-changed";
let forNewChat = false;
let inMemory: string[] = [];

function threads(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(list) ? list.filter(id => typeof id === "string") : [];
  } catch {
    return inMemory;
  }
}

function save(list: string[]) {
  inMemory = list;
  try { localStorage.setItem(key, JSON.stringify(list)); } catch {}
}

const announce = () => window.dispatchEvent(new Event(changed));

export const debugMode = {
  isOn(threadId: string | null | undefined) {
    return threadId ? threads().includes(threadId) : forNewChat;
  },
  set(threadId: string | null | undefined, on: boolean) {
    if (!threadId) forNewChat = on;
    else save(on ? [...new Set([...threads(), threadId])] : threads().filter(id => id !== threadId));
    announce();
  },
  /** At send time: a chat's first message carries the switch set before the chat existed. */
  forRequest(threadId: string, firstMessage: boolean) {
    if (firstMessage && forNewChat) {
      forNewChat = false;
      save([...new Set([...threads(), threadId])]);
      announce();
    }
    return threads().includes(threadId);
  },
  forget(threadId: string) {
    save(threads().filter(id => id !== threadId));
    announce();
  },
  subscribe(listener: () => void) {
    window.addEventListener(changed, listener);
    window.addEventListener("storage", listener);
    return () => {
      window.removeEventListener(changed, listener);
      window.removeEventListener("storage", listener);
    };
  },
};

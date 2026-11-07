import type { ActivityEvent } from "@/lib/activity";

/**
 * Activity in this browser, beside the chat history: one entry per request, keyed by the user message that started
 * it. IndexedDB, not localStorage, so it never competes with the chat for the 5 MB quota. Entries go with their chat
 * and expire after `retentionDays`.
 */
export type ActivityEntry = {
  threadId: string;
  userMessageId: string;
  startedAt: number;
  events: ActivityEvent[];
  /** Set when the stream ended: "done" after the server's reply event, otherwise how it ended. */
  ended?: "done" | "cancelled" | "interrupted";
};

const database = "rich-ai-chat-activity";
const storeName = "entries";
const retentionDays = 90;
const memory = new Map<string, ActivityEntry>();
const loading = new Set<string>();
const listeners = new Map<string, Set<() => void>>();
let opened: Promise<IDBDatabase | undefined> | undefined;

function open() {
  if (typeof indexedDB === "undefined") return Promise.resolve(undefined);
  opened ??= new Promise(resolve => {
    const request = indexedDB.open(database, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(storeName, { keyPath: "userMessageId" });
      store.createIndex("threadId", "threadId");
      store.createIndex("startedAt", "startedAt");
    };
    request.onsuccess = () => {
      resolve(request.result);
      void prune(request.result);
    };
    request.onerror = () => resolve(undefined);
  });
  return opened;
}

function run<T>(db: IDBDatabase, mode: IDBTransactionMode, body: (store: IDBObjectStore) => IDBRequest<T> | void) {
  return new Promise<T | undefined>(resolve => {
    const transaction = db.transaction(storeName, mode);
    const request = body(transaction.objectStore(storeName));
    transaction.oncomplete = () => resolve(request ? request.result : undefined);
    transaction.onerror = transaction.onabort = () => resolve(undefined);
  });
}

async function prune(db: IDBDatabase) {
  const cutoff = Date.now() - retentionDays * 86400000;
  await run(db, "readwrite", store => {
    const cursor = store.index("startedAt").openCursor(IDBKeyRange.upperBound(cutoff));
    cursor.onsuccess = () => { cursor.result?.delete(); cursor.result?.continue(); };
  });
}

function notify(userMessageId: string) {
  for (const listener of listeners.get(userMessageId) ?? []) listener();
}

async function save(entry: ActivityEntry) {
  const db = await open();
  if (db) await run(db, "readwrite", store => store.put(entry));
}

export const activityStore = {
  begin(threadId: string, userMessageId: string) {
    const entry: ActivityEntry = { threadId, userMessageId, startedAt: Date.now(), events: [] };
    memory.set(userMessageId, entry);
    notify(userMessageId);
    void save(entry);
  },
  add(userMessageId: string, event: ActivityEvent) {
    const entry = memory.get(userMessageId);
    if (!entry) return;
    const next = { ...entry, events: [...entry.events, event] };
    memory.set(userMessageId, next);
    notify(userMessageId);
    void save(next);
  },
  end(userMessageId: string, how: "cancelled" | "interrupted") {
    const entry = memory.get(userMessageId);
    if (!entry || entry.ended) return;
    const done = entry.events.some(event => event.type === "reply");
    const next = { ...entry, ended: done ? "done" as const : how };
    memory.set(userMessageId, next);
    notify(userMessageId);
    void save(next);
  },
  /** The entry for a user message: from memory, or loaded once from IndexedDB (listeners hear when it arrives). */
  get(userMessageId: string) {
    const entry = memory.get(userMessageId);
    if (!entry && !loading.has(userMessageId)) {
      loading.add(userMessageId);
      void open().then(db => db && run<ActivityEntry>(db, "readonly", store => store.get(userMessageId))).then(stored => {
        if (stored && !memory.has(userMessageId)) {
          memory.set(userMessageId, stored);
          notify(userMessageId);
        }
      });
    }
    return entry;
  },
  subscribe(userMessageId: string, listener: () => void) {
    const set = listeners.get(userMessageId) ?? new Set();
    set.add(listener);
    listeners.set(userMessageId, set);
    return () => { set.delete(listener); };
  },
  async thread(threadId: string) {
    const db = await open();
    const stored = db ? await run<ActivityEntry[]>(db, "readonly", store => store.index("threadId").getAll(threadId)) ?? [] : [];
    const merged = new Map(stored.map(entry => [entry.userMessageId, entry]));
    for (const entry of memory.values()) if (entry.threadId === threadId) merged.set(entry.userMessageId, entry);
    return [...merged.values()].sort((a, b) => a.startedAt - b.startedAt);
  },
  async deleteThread(threadId: string) {
    for (const [id, entry] of memory) if (entry.threadId === threadId) { memory.delete(id); loading.delete(id); notify(id); }
    const db = await open();
    if (!db) return;
    const keys = await run<IDBValidKey[]>(db, "readonly", store => store.index("threadId").getAllKeys(threadId)) ?? [];
    await run(db, "readwrite", store => { for (const key of keys) store.delete(key); });
  },
  /** One JSON line per request, for analysis outside the app. Holds ids, timings and allowlisted summaries only. */
  async exportThread(threadId: string) {
    return (await activityStore.thread(threadId)).map(entry => JSON.stringify(entry)).join("\n") + "\n";
  },
};

/** Read Activity events from a copy of the reply stream (server-sent `data-activity` parts) into the store. */
export async function collectActivity(body: ReadableStream<Uint8Array>, threadId: string, userMessageId: string, signal?: AbortSignal) {
  activityStore.begin(threadId, userMessageId);
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: {")) continue;
        try {
          const chunk = JSON.parse(line.slice(6));
          if (chunk.type === "data-activity" && chunk.data) activityStore.add(userMessageId, chunk.data as ActivityEvent);
        } catch { /* not ours */ }
      }
    }
  } catch { /* the stream was cancelled */ }
  activityStore.end(userMessageId, signal?.aborted ? "cancelled" : "interrupted");
}

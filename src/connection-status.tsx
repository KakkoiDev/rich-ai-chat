"use client";

import { useThread } from "@openuidev/react-headless";
import { useCallback, useEffect, useRef, useState } from "react";
import { checkConnection, reachabilityText, type Reachability } from "@/lib/connection";

/** While the host is unreachable, look again this often (only while the page is visible). */
const recheckMs = 15000;

/**
 * The chat shell's connection line, above the composer: offline, host unreachable or Tailscale off, each with Retry.
 * A reply that failed because the connection was down is sent again once the host answers. It also registers the
 * shell's offline worker (public/sw.js) in production builds, so the chat opens without a connection.
 */
export function ConnectionStatus() {
  const messages = useThread(state => state.messages);
  const threadError = useThread(state => state.threadError);
  const isRunning = useThread(state => state.isRunning);
  const processMessage = useThread(state => state.processMessage);
  const deleteMessage = useThread(state => state.deleteMessage);
  const [reachability, setReachability] = useState<Reachability>("online");
  const [checking, setChecking] = useState(false);
  const resume = useRef(false); // a reply failed while the host was unreachable
  const latest = useRef({ messages, isRunning, threadError });
  useEffect(() => { latest.current = { messages, isRunning, threadError }; }, [messages, isRunning, threadError]);

  // Called back once the check has answered, never during an effect's own run.
  const settle = useCallback((next: Reachability) => {
    setReachability(next);
    const { messages, isRunning, threadError } = latest.current;
    const last = messages.at(-1);
    if (next === "online" && resume.current && !isRunning && threadError && last?.role === "user") {
      resume.current = false;
      deleteMessage(last.id);
      void processMessage({ role: "user", content: last.content });
    }
    return next;
  }, [deleteMessage, processMessage]);
  const check = useCallback(() => checkConnection().then(settle), [settle]);

  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator)
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    const online = () => void check();
    const offline = () => setReachability("offline");
    const visible = () => { if (document.visibilityState === "visible") void check(); };
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", visible);
    void check();
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [check]);

  // A failed reply: find out whether the connection was the reason; if so, send it again once it is back.
  useEffect(() => {
    if (!threadError) return;
    void check().then(next => { if (next !== "online") resume.current = true; });
  }, [threadError, check]);

  useEffect(() => {
    if (reachability === "online") return;
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void check(); }, recheckMs);
    return () => window.clearInterval(timer);
  }, [reachability, check]);

  async function retry() {
    setChecking(true);
    await check();
    setChecking(false);
  }

  if (reachability === "online") return null;
  const text = reachabilityText[reachability];
  return (
    <div className="connection-status" role="status" data-state={reachability}>
      <p><strong>{text.title}</strong> {text.detail}</p>
      <button type="button" disabled={checking} onClick={() => void retry()}>{checking ? "Checking…" : "Retry"}</button>
    </div>
  );
}

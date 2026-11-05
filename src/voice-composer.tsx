"use client";

import { useThreadList } from "@openuidev/react-headless";
import { AgentInterface, IconButton } from "@openuidev/react-ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Session = {
  stream?: MediaStream;
  recorder?: MediaRecorder;
  timer?: number;
  upload: AbortController;
};
type Status = "idle" | "opening" | "recording" | "transcribing";

function release(session: Session) {
  window.clearTimeout(session.timer);
  session.stream?.getTracks().forEach(track => track.stop());
}

function insertDraft(input: HTMLTextAreaElement, transcript: string) {
  const { value, selectionStart, selectionEnd } = input;
  const before = value.slice(0, selectionStart);
  const after = value.slice(selectionEnd);
  const insertion = (before && !/\s$/.test(before) ? " " : "") + transcript
    + (after && !/^\s/.test(after) ? " " : "");
  // OpenUI owns the controlled textarea. Notify React through its native input event.
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(input, before + insertion + after);
  input.focus();
  input.setSelectionRange(before.length + insertion.length, before.length + insertion.length);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function Dictate({ target }: { target: HTMLElement }) {
  const active = useRef<Session | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  useEffect(() => () => {
    const session = active.current;
    active.current = null;
    if (!session) return;
    session.upload.abort();
    release(session);
  }, []);

  async function toggle() {
    if (active.current?.recorder?.state === "recording") {
      active.current.recorder.stop();
      return;
    }
    if (active.current) return;
    setError("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Microphone access needs localhost or a secure HTTPS connection.");
      return;
    }
    const session: Session = { upload: new AbortController() };
    active.current = session;
    setStatus("opening");
    function finish(message = "") {
      release(session);
      if (active.current !== session) return;
      active.current = null;
      setStatus("idle");
      setError(message);
    }
    try {
      session.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (active.current !== session) { release(session); return; }
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"]
        .find(type => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(session.stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 64000 });
      session.recorder = recorder;
      const chunks: Blob[] = [];
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => finish("Recording failed. Try again.");
      recorder.onstop = async () => {
        release(session);
        if (active.current !== session) return;
        if (!chunks.length) { finish("No audio recorded. Try again."); return; }
        setStatus("transcribing");
        try {
          const audio = new Blob(chunks, { type: recorder.mimeType || chunks[0].type });
          const response = await fetch("/api/transcribe", { method: "POST", body: audio, signal: session.upload.signal });
          const result = await response.json() as { text?: string; error?: string };
          if (!response.ok || !result.text) throw new Error(result.error || "No speech detected.");
          if (active.current !== session) return;
          const input = target.closest(".openui-agent-thread-composer")?.querySelector("textarea");
          if (!input) { finish("Could not find the chat draft."); return; }
          insertDraft(input, result.text);
          finish();
        } catch (cause) {
          finish(cause instanceof Error ? cause.message : "Transcription failed. Try again.");
        }
      };
      recorder.start();
      setStatus("recording");
      session.timer = window.setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, 60_000);
    } catch (cause) {
      finish(cause instanceof DOMException && cause.name === "NotAllowedError"
        ? "Microphone access was denied. Allow it in your browser and try again."
        : "Could not open the microphone. Check that it is available.");
    }
  }

  const label = status === "recording" ? "Stop recording" : "Dictate";
  const message = error || (status === "opening" ? "Waiting for microphone…" : status === "recording"
    ? "Recording…" : status === "transcribing" ? "Transcribing on this Mac…" : "");
  return (
    <div className="voice-control">
      {message && <span role={error ? "alert" : "status"} className="voice-control__status">{message}</span>}
      <IconButton
        aria-label={label}
        title={label}
        aria-pressed={status === "recording"}
        disabled={status === "opening" || status === "transcribing"}
        onClick={toggle}
        variant="tertiary"
        size="small"
        icon={<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          {status === "recording" ? <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /> : <>
            <rect x="9" y="2" width="6" height="12" rx="3" />
            <path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4" />
          </>}
        </svg>}
      />
    </div>
  );
}

export function VoiceComposer() {
  const thread = useThreadList(state => state.selectedThreadId);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const bind = useCallback((node: HTMLDivElement | null) => {
    setTarget(node?.querySelector<HTMLElement>(".openui-agent-thread-composer__action-bar") ?? null);
  }, []);
  return (
    <div ref={bind}>
      <AgentInterface.Composer />
      {target && createPortal(<Dictate key={thread ?? "new"} target={target} />, target)}
    </div>
  );
}

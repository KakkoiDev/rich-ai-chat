"use client";

import { IconButton } from "@openuidev/react-ui";
import { useEffect, useRef, useState } from "react";

type Session = {
  stream?: MediaStream;
  recorder?: MediaRecorder;
  timer?: number;
  meter?: number;
  context?: AudioContext;
  upload: AbortController;
};
type Status = "idle" | "opening" | "recording" | "transcribing";

function release(session: Session) {
  window.clearTimeout(session.timer);
  window.clearInterval(session.meter);
  if (session.context && session.context.state !== "closed") void session.context.close().catch(() => {});
  session.context = undefined;
  session.stream?.getTracks().forEach(track => track.stop());
}

// Require sustained sound before a pause can end dictation. Sample the microphone
// locally; the analyser is not connected to the speakers.
function stopAfterSpeech(session: Session, stop: (silent?: boolean) => void) {
  if (!session.context || !session.stream) return;
  const context = session.context;
  const meter = context.createAnalyser();
  meter.fftSize = 1024;
  context.createMediaStreamSource(session.stream).connect(meter);
  const samples = new Float32Array(meter.fftSize);
  let noise = 0.003;
  let consecutive = 0;
  let lastVoice = 0;
  let started: number | undefined;
  session.meter = window.setInterval(() => {
    if (context.state !== "running") return;
    const now = performance.now();
    started ??= now;
    meter.getFloatTimeDomainData(samples);
    const rms = Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);
    if (rms > Math.max(0.008, noise * 3)) {
      if (++consecutive >= 2 || lastVoice) lastVoice = now;
    } else {
      consecutive = 0;
      noise = Math.min(0.015, noise * 0.97 + rms * 0.03);
    }
    if (lastVoice && now - lastVoice >= 1400) stop();
    else if (!lastVoice && now - started >= 9000) stop(true);
  }, 50);
}

export function VoiceControl({ insert, reportError }: {
  insert: (text: string) => void;
  reportError: (error: string) => void;
}) {
  const active = useRef<Session | null>(null);
  const [status, setStatus] = useState<Status>("idle");
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
    reportError("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      reportError("Microphone access needs localhost or a secure HTTPS connection.");
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
      reportError(message);
    }
    // Resume from the click so browsers that require a gesture can run the meter.
    try {
      if (typeof AudioContext !== "undefined") {
        session.context = new AudioContext();
        void session.context.resume().catch(() => {});
      }
    } catch {
      // Recording still works with manual Stop when the analyser is unavailable.
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
      let noSpeech = false;
      recorder.onstop = async () => {
        release(session);
        if (active.current !== session) return;
        if (noSpeech || !chunks.length) { finish("No speech detected. Try again."); return; }
        setStatus("transcribing");
        try {
          const audio = new Blob(chunks, { type: recorder.mimeType || chunks[0].type });
          const response = await fetch("/api/transcribe", { method: "POST", body: audio, signal: session.upload.signal });
          const result = await response.json() as { text?: string; error?: string };
          if (!response.ok || !result.text) throw new Error(result.error || "No speech detected.");
          if (active.current !== session) return;
          insert(result.text);
          finish();
        } catch (cause) {
          finish(cause instanceof Error ? cause.message : "Transcription failed. Try again.");
        }
      };
      recorder.start();
      setStatus("recording");
      const stop = (silent = false) => {
        if (recorder.state !== "recording") return;
        noSpeech = silent;
        recorder.stop();
      };
      session.timer = window.setTimeout(stop, 60_000);
      try { stopAfterSpeech(session, stop); } catch { /* Manual Stop remains available. */ }
    } catch (cause) {
      finish(cause instanceof DOMException && cause.name === "NotAllowedError"
        ? "Microphone access was denied. Allow it in your browser and try again."
        : "Could not open the microphone. Check that it is available.");
    }
  }

  const label = status === "recording" ? "Stop recording"
    : status === "transcribing" ? "Transcribing" : status === "opening" ? "Waiting for microphone" : "Dictate";
  const message = (status === "opening" ? "Waiting for microphone…" : status === "recording"
    ? "Listening…" : status === "transcribing" ? "Transcribing on this Mac…" : "");
  return (
    <div className="voice-control" data-state={status}>
      <span role="status" className="voice-control__status">{message}</span>
      <IconButton
        aria-label={label}
        title={label}
        className="voice-control__button"
        aria-pressed={status === "recording"}
        disabled={status === "opening" || status === "transcribing"}
        onClick={toggle}
        variant="tertiary"
        size="small"
        icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          {status === "transcribing" || status === "opening" ? <path className="voice-control__spinner" d="M20 12a8 8 0 1 0-8 8" />
            : status === "recording" ? <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /> : <>
            <rect x="9" y="2" width="6" height="12" rx="3" />
            <path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4" />
          </>}
        </svg>}
      />
    </div>
  );
}

"use client";

import { parseMessage } from "@openuidev/react-lang";
import { useThread, useThreadList, type BinaryInputContent, type UserMessage } from "@openuidev/react-headless";
import { Button, IconButton, ModelSwitcher } from "@openuidev/react-ui";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { debugMode } from "@/lib/debug-mode";
import { chatFileExtensions, chatFileMime, decodeChatText, isChatFilename, maxChatFileBytes, maxChatFiles } from "@/lib/chat-files";
import { VoiceControl } from "@/voice-composer";
import { ReplyActivity } from "@/reply-activity";

type Attachment = BinaryInputContent & { data: string; filename: string };
type Starter = { displayText: string; prompt: string };
type Props = {
  model: string;
  models: { id: string; name: string; group?: string }[];
  selectModel: (model: string) => void;
  starters: Starter[];
};

export function ChatUserMessage({ message }: { message: UserMessage }) {
  const text = typeof message.content === "string" ? parseMessage(message.content).content
    : message.content.filter(part => part.type === "text").map(part => part.text).join("");
  const files = typeof message.content === "string" ? [] : message.content.filter(part => part.type === "binary");
  return <div className="openui-shell-thread-message-user">
    <div className="openui-genui-user-message">
      {!!files.length && <ul className="chat-files">{files.map((file, i) => <li key={i}>{file.filename || "Attachment"}</li>)}</ul>}
      {text && <div className="openui-shell-thread-message-user__content">{text}</div>}
    </div>
    <ReplyActivity userMessageId={message.id} />
  </div>;
}

export function ChatComposer(props: Props) {
  const thread = useThreadList(state => state.selectedThreadId);
  return <ComposerDraft key={thread ?? "new"} thread={thread} {...props} />;
}

function ComposerDraft({ model, models, selectModel, starters, thread }: Props & { thread?: string | null }) {
  const debugging = useSyncExternalStore(debugMode.subscribe, () => debugMode.isOn(thread), () => false);
  const { processMessage, cancelMessage, isRunning, isLoadingMessages, messages } = useThread();
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  const attached = useRef<Attachment[]>([]);
  const loading = useRef(false);

  useEffect(() => {
    if (window.matchMedia("(pointer: fine)").matches) input.current?.focus();
  }, []);
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.max(el.scrollHeight, 32)}px`;
    if (caret.current !== null) {
      el.focus();
      el.setSelectionRange(caret.current, caret.current);
      caret.current = null;
    }
  }, [draft]);

  async function addFiles(selected: FileList | null) {
    if (!selected || !selected.length || loading.current) return;
    loading.current = true;
    setReading(true);
    setError("");
    const next = [...attached.current];
    const errors: string[] = [];
    for (const file of Array.from(selected)) {
      if (next.length >= maxChatFiles) { errors.push(`Attach up to ${maxChatFiles} files.`); break; }
      if (!isChatFilename(file.name)) { errors.push(`${file.name}: choose a text file such as TXT, CSV, Markdown or source code.`); continue; }
      if (!file.size || file.size > maxChatFileBytes) { errors.push(`${file.name}: choose a nonempty file up to 12 KB.`); continue; }
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        decodeChatText(bytes);
        const data = btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(""));
        next.push({ type: "binary", mimeType: chatFileMime, filename: file.name, data });
      } catch { errors.push(`${file.name}: could not read UTF-8 text.`); }
    }
    attached.current = next;
    setFiles(next);
    setError(errors[0] || "");
    loading.current = false;
    setReading(false);
  }

  function submit(text = input.current?.value ?? draft) {
    if (isRunning || isLoadingMessages || loading.current || (!text.trim() && !attached.current.length)) return;
    const current = attached.current;
    attached.current = [];
    setFiles([]);
    setDraft("");
    setError("");
    void processMessage({
      role: "user",
      content: current.length ? [{ type: "text", text: text.trim() || "Please review the attached files." }, ...current] : text,
    });
  }

  function insert(text: string) {
    const el = input.current;
    if (!el) return;
    const before = el.value.slice(0, el.selectionStart);
    const after = el.value.slice(el.selectionEnd);
    const insertion = (before && !/\s$/.test(before) ? " " : "") + text + (after && !/^\s/.test(after) ? " " : "");
    caret.current = before.length + insertion.length;
    setDraft(before + insertion + after);
  }

  return <>
    {!isLoadingMessages && messages.length === 0 && <div className="chat-starters">
      {starters.map(starter => <Button key={starter.prompt} variant="tertiary" size="small" onClick={() => submit(starter.prompt)}>{starter.displayText}</Button>)}
    </div>}
    <div className="openui-agent-thread-composer rich-chat-composer">
      <div className="openui-agent-thread-composer__input-wrapper rich-chat-composer__box">
        {!!files.length && <ul className="chat-files rich-chat-composer__files">
          {files.map((file, i) => <li key={i}>
            <span title={file.filename}>{file.filename}</span>
            <button type="button" aria-label={`Remove ${file.filename}`} onClick={() => {
              attached.current = attached.current.filter((_, index) => index !== i);
              setFiles(attached.current);
            }}>×</button>
          </li>)}
        </ul>}
        <textarea ref={input} value={draft} rows={1} onChange={e => setDraft(e.target.value)}
          className="openui-agent-thread-composer__input" placeholder="Ask anything..." aria-label="Message"
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
              e.preventDefault();
              submit();
            }
          }} />
        <div className="rich-chat-composer__actions">
          <input hidden ref={picker} type="file" aria-label="Choose files" multiple accept={chatFileExtensions}
            onChange={e => { void addFiles(e.target.files); e.target.value = ""; }} />
          <IconButton className="voice-control__button" aria-label="Attach files" title="Attach text files" variant="tertiary" size="small"
            disabled={reading || files.length >= maxChatFiles} onClick={() => picker.current?.click()}
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>} />
          <div className="rich-chat-composer__spacer" />
          <label className="debug-switch" title="Record full text for this chat: your messages, the prompts, tool results and rejected drafts. It shows in Activity and in the server's debug file, kept 7 days.">
            <input type="checkbox" checked={debugging} onChange={e => debugMode.set(thread, e.target.checked)} aria-label="Debug this chat" />
            <span className="debug-switch__text">Debug</span>
          </label>
          <ModelSwitcher models={models} value={model} onValueChange={selectModel} />
          <VoiceControl insert={insert} reportError={setError} />
          <IconButton aria-label={isRunning ? "Cancel message" : "Send message"} title={isRunning ? "Cancel" : "Send"}
            className="openui-agent-thread-composer__submit-button" variant="primary" size="small"
            onClick={() => isRunning ? cancelMessage() : submit()} disabled={!isRunning && (reading || isLoadingMessages || (!draft.trim() && !files.length))}
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {isRunning ? <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /> : <path d="M12 19V5m-6 6 6-6 6 6" />}
            </svg>} />
        </div>
      </div>
      {error && <p className="voice-control__error" role="alert">{error}</p>}
      {!!files.length && model === "deepseek-flash" && <p className="voice-control__error">Sending will share the attached text with DeepSeek.</p>}
    </div>
  </>;
}

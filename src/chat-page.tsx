"use client";

import { useSyncExternalStore } from "react";
import { chatModelIds, chatModelLabels, isChatModelId } from "@/lib/chat-models";
import { localStorageChat } from "@/lib/local-storage";
import { debugMode } from "@/lib/debug-mode";
import {
  AgentInterface,
  fetchLLM,
  useSystemThemeMode,
  vercelAIAdapter,
  vercelAIMessageFormat,
} from "@openuidev/react-ui";
import { library } from "@/library";
import { ChatComposer, ChatUserMessage } from "@/chat-composer";

const serverDefault = "server-default";
const modelOptions = [
  ...chatModelIds.map(id => ({
    id,
    name: chatModelLabels[id],
    group: id === "deepseek-flash" ? "Hosted" : "Local · Ollama",
  })),
];

const modelKey = "rich-ai-chat:model";
const modelChanged = "rich-ai-chat:model-changed";
let selectedInMemory = "";

function readModel() {
  try {
    const model = localStorage.getItem(modelKey) ?? "";
    return isChatModelId(model) ? model : "";
  } catch {
    return selectedInMemory;
  }
}

function subscribeModel(listener: () => void) {
  window.addEventListener(modelChanged, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(modelChanged, listener);
    window.removeEventListener("storage", listener);
  };
}

function selectModel(value: string) {
  selectedInMemory = isChatModelId(value) ? value : "";
  try { localStorage.setItem(modelKey, selectedInMemory); } catch {}
  window.dispatchEvent(new Event(modelChanged));
}

function chatTransport(model?: string, debug = false) {
  return fetchLLM({
    url: "/api/chat",
    streamAdapter: vercelAIAdapter(),
    fetch(input, init) {
      const headers = new Headers(init?.headers);
      headers.set("X-Chat-Time-Zone", Intl.DateTimeFormat().resolvedOptions().timeZone);
      return fetch(input, { ...init, headers });
    },
    messageFormat: {
      ...vercelAIMessageFormat,
      toApi(messages) {
        // Retain the most recent set of attachments for follow-ups without
        // repeatedly shipping every file stored in this browser.
        const withFiles = messages.findLastIndex(message => message.role === "user"
          && Array.isArray(message.content) && message.content.some(part => part.type === "binary"));
        return vercelAIMessageFormat.toApi(messages.map((message, index) => {
          if (index === withFiles || message.role !== "user" || !Array.isArray(message.content)) return message;
          return { ...message, content: message.content.filter(part => part.type !== "binary") };
        }));
      },
    },
    body: model || debug ? { ...(model ? { model } : {}), ...(debug ? { debug } : {}) } : undefined,
  });
}

const defaultTransport = chatTransport();
const transports = new Map([undefined, ...chatModelIds].flatMap(model => [false, true]
  .map(debug => [`${model ?? ""}|${debug}`, chatTransport(model, debug)] as const)));
const { llm, storage } = localStorageChat({
  ...defaultTransport,
  send(params) {
    const model = readModel();
    const debug = debugMode.forRequest(params.threadId, params.messages.filter(message => message.role === "user").length <= 1);
    return transports.get(`${isChatModelId(model) ? model : ""}|${debug}`)!.send(params);
  },
}, "rich-ai-chat");

export default function ChatPage({ defaultModelLabel }: { defaultModelLabel: string }) {
  const mode = useSystemThemeMode();
  const model = useSyncExternalStore(subscribeModel, readModel, () => "");

  // The route returns the AI SDK's native UIMessage stream, so the browser
  // decodes it with the SDK's own adapter and message format.
  return (
    <div className="app-shell">
      <AgentInterface
        llm={llm}
        storage={storage}
        componentLibrary={library}
        agentName="KakkoiSchool Rich Chat"
        theme={{ mode }}
        components={{ UserMessage: ChatUserMessage }}
      >
        <AgentInterface.Composer>
          <ChatComposer model={model || serverDefault} models={[{ id: serverDefault, name: `${defaultModelLabel} (default)` }, ...modelOptions]} selectModel={selectModel} starters={[
            { displayText: "Weather in Tokyo", prompt: "What's the weather like in Tokyo right now?" },
            { displayText: "Try web search", prompt: "Search the web for a recent NASA astronomy discovery and cite your sources." },
            { displayText: "Water cycle image", prompt: "Show the classroom water cycle illustration and explain what it shows." },
            { displayText: "Build a calculator", prompt: "Build a working calculator I can use right here." },
            { displayText: "Make a game", prompt: "Make a playable two-player tic-tac-toe game." },
          ]} />
        </AgentInterface.Composer>
      </AgentInterface>
    </div>
  );
}

"use client";

import { useSyncExternalStore } from "react";
import { chatModelIds, chatModelLabels, isChatModelId } from "@/lib/chat-models";
import { localStorageChat } from "@/lib/local-storage";
import {
  AgentInterface,
  ModelSwitcher,
  fetchLLM,
  useSystemThemeMode,
  vercelAIAdapter,
  vercelAIMessageFormat,
} from "@openuidev/react-ui";
import { library } from "@/library";
import { VoiceComposer } from "@/voice-composer";

const serverDefault = "server-default";
const modelOptions = [
  { id: serverDefault, name: "Server default" },
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

function chatTransport(model?: string) {
  return fetchLLM({
    url: "/api/chat",
    streamAdapter: vercelAIAdapter(),
    messageFormat: vercelAIMessageFormat,
    body: model ? { model } : undefined,
  });
}

const defaultTransport = chatTransport();
const transports = new Map(chatModelIds.map(model => [model, chatTransport(model)]));
const { llm, storage } = localStorageChat({
  ...defaultTransport,
  send(params) {
    const model = readModel();
    return (isChatModelId(model) ? transports.get(model)! : defaultTransport).send(params);
  },
}, "rich-ai-chat");

export default function Page() {
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
        starterVariant="short"
        starters={[
          {
            displayText: "Weather in Tokyo",
            prompt: "What's the weather like in Tokyo right now?",
          },
          { displayText: "Try web search", prompt: "Search the web for a recent NASA astronomy discovery and cite your sources." },
          { displayText: "Water cycle image", prompt: "Show the classroom water cycle illustration and explain what it shows." },
          { displayText: "Build a calculator", prompt: "Build a working calculator I can use right here." },
          { displayText: "Make a game", prompt: "Make a playable two-player tic-tac-toe game." },
        ]}
      >
        <AgentInterface.SidebarFooter className="chat-model-picker">
          <span className="chat-model-picker__label">Model</span>
          <ModelSwitcher models={modelOptions} value={model || serverDefault} onValueChange={selectModel} />
          <span className="chat-model-picker__hint" aria-live="polite">
            {model === "deepseek-flash" ? "Sends chat to DeepSeek" : model ? "Runs on Ollama" : "Uses server settings"}
          </span>
        </AgentInterface.SidebarFooter>
        <AgentInterface.Composer>
          <VoiceComposer />
        </AgentInterface.Composer>
      </AgentInterface>
    </div>
  );
}

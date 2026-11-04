"use client";

import { localStorageChat } from "@/lib/local-storage";
import {
  AgentInterface,
  fetchLLM,
  useSystemThemeMode,
  vercelAIAdapter,
  vercelAIMessageFormat,
} from "@openuidev/react-ui";
import { openuiLibrary } from "@openuidev/react-ui/genui-lib";

const { llm, storage } = localStorageChat(
  fetchLLM({
    url: "/api/chat",
    streamAdapter: vercelAIAdapter(),
    messageFormat: vercelAIMessageFormat,
  }),
  "rich-ai-chat",
);

export default function Page() {
  const mode = useSystemThemeMode();

  // The route returns the AI SDK's native UIMessage stream, so the browser
  // decodes it with the SDK's own adapter and message format.
  return (
    <div className="app-shell">
      <AgentInterface
        llm={llm}
        storage={storage}
        componentLibrary={openuiLibrary}
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
          { displayText: "Draw a process", prompt: "Show photosynthesis as a simple diagram with labeled steps." },
        ]}
      />
    </div>
  );
}

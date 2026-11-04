# KakkoiSchool Rich AI Chat

Standalone classroom prototype adapted from the OpenUI Vercel AI SDK example (MIT). Keep this prototype bound to localhost. Chats are stored in the browser; use sample questions rather than student records.

## Video walkthrough

[Watch or download the Playwright walkthrough](docs/walkthrough.webm?raw=true). The visible cursor follows the Izumo weather question, a Japanese follow-up, and an inline illustration. The weather shown is from a sample conversation.

## Run locally

1. Run `npm ci`.
2. Copy `.env.example` to `.env.local`. Set `MODEL_API_KEY` for DeepSeek Flash and `BRAVE_SEARCH_API_KEY` for live search.
3. Run `npm run dev -- --hostname 127.0.0.1 --port 3210` and open http://127.0.0.1:3210.
4. Try the search, water cycle image, and diagram prompts on the start screen.

DeepSeek's hosted endpoint receives chat text. To keep inference local, set `MODEL_BASE_URL` and `MODEL_ID` to a running OpenAI-compatible server and its model ID. For Ollama use `http://127.0.0.1:11434/v1`. Search still sends the short query to Brave; Safe Search and obvious personal-data checks reduce risk but cannot guarantee anonymity. Images can only load from this app. For the prototype, the water-cycle illustration is the only bundled classroom image.

See [STEP-2.md](STEP-2.md) for the reusable PLH work.

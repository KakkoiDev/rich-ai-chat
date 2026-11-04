# KakkoiSchool Rich AI Chat

Standalone classroom prototype adapted from the OpenUI Vercel AI SDK example (MIT). Keep this prototype bound to localhost. Chats are stored in the browser; use sample questions rather than student records.

## Video walkthrough

[![Rich AI Chat walkthrough — click to watch](docs/walkthrough-preview.png)](https://raw.githubusercontent.com/KakkoiDev/rich-ai-chat/main/docs/walkthrough.webm)

[Watch or download the Playwright walkthrough](https://raw.githubusercontent.com/KakkoiDev/rich-ai-chat/main/docs/walkthrough.webm). The visible cursor follows the Izumo weather question, a Japanese follow-up, and an inline illustration. The weather shown is from a sample conversation.

## Run locally

1. Run `npm ci`.
2. Copy `.env.example` to `.env.local`. Set `MODEL_API_KEY` for DeepSeek Flash and `BRAVE_SEARCH_API_KEY` for live search.
3. Run `npm run dev -- --hostname 127.0.0.1 --port 3210` and open http://127.0.0.1:3210.
4. Try the search, water cycle image, and diagram prompts on the start screen.

DeepSeek's hosted endpoint receives chat text. To keep inference local, set `MODEL_BASE_URL` and `MODEL_ID` to a running OpenAI-compatible server and its model ID. For Ollama use `http://127.0.0.1:11434/v1`. Search still sends the short query to Brave; Safe Search and obvious personal-data checks reduce risk but cannot guarantee anonymity. Images can only load from this app. For the prototype, the water-cycle illustration is the only bundled classroom image.

See [STEP-2.md](STEP-2.md) for the reusable PLH work.

## Build mini-apps and games

Ask for a calculator, a quiz, or a playable game. Choose **Run preview** to run the generated HTML, CSS, and JavaScript, or **View source** to inspect it. The preview starts only when you click Run. Controls run inside the preview without new chat messages. Stopping the preview clears its runtime state; the source stays in the conversation.

Previews use an iframe with an opaque origin and a restrictive content policy. They cannot use external scripts, API calls, or the chat's storage. Keep previews small: the sandbox does not guarantee a CPU or memory limit for generated JavaScript. File edits and GitHub PRs are separate future phases in [the design doc](APP-BUILDER-DESIGN.md).

### Play-test and revise

Run the preview and try the controls. The preview reports script errors and blocked browser operations as they happen. A clean startup check does not verify game rules or layout. Describe what went wrong or what should change, then click **Request revision**. The chat sends the current source, your notes, and up to five diagnostics to the configured model in one request. The revision appears as a new artifact, so you can test it without losing the original. **Restart test** resets the preview and clears the previous diagnostics.

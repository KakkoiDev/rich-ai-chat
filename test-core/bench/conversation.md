# Conversation testing protocol

Use one fresh, synthetic conversation per scenario and model. A scenario is a sequence of user turns with an assertion for each turn. Assert both what happened (for example, the weather tool was called) and what the person received (for example, a chart with dates and values). Keep app-specific prompts, fixtures and UI checks in the app.

```js
import assert from 'node:assert/strict';
import { runConversation } from './test-core/bench/conversation.mjs';

const result = await runConversation([
  ['Show me a map of Paris.', answer => assert.match(answer, /Paris/)],
  ['Zoom out a little.', (answer, previous, events) => {
    assert.ok(events.some(event => event.type === 'map-zoomed'));
    assert.notEqual(answer, previous[0]);
  }],
], async (history, signal) => {
  // Convert {role, text} messages to your API format, or send only the last
  // user message to a browser tab dedicated to this scenario.
  const { answer, events } = await sendChat(history, signal);
  return { answer, evidence: events, activity: events.map(({ type }) => ({ type })) };
}, { signal });
```

The adapter returns a complete visible answer or throws on transport failure. It can attach sanitized `activity` for the report and separate `evidence` for assertions only. Assertions can be async. A bad answer fails its turn, but remains the actual context for the next one. If no answer arrives, the scenario stops and fails. The result includes each turn's prompt, answer, optional activity, status, elapsed seconds and failure detail. Persist results per scenario so interrupted suites keep completed data.

Use the [response proxy](response-proxy.md) for paid HTTP calls, local fixtures for free services when practical, and only synthetic prompts. Replay by default and count cache misses as failures even if the app recovers. Never put production chat, keys, or tool secrets in reports or fixtures.

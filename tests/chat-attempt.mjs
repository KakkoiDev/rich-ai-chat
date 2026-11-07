import assert from "node:assert/strict";
import { test } from "node:test";
import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";
import { chatModelIds } from "../src/lib/chat-models.ts";
import { readChatAttempt } from "../src/lib/chat-attempt.ts";

const timeouts = { opening: 30, answer: 20, tool: 30 };
const delta = (delta) => ({ type: "text-delta", id: "answer", delta });
const finish = (finishReason) => ({ type: "finish", finishReason });
const signal = () => new AbortController().signal;
const scripted = (...chunks) => new ReadableStream({
  start(controller) { for (const chunk of chunks) controller.enqueue(chunk); },
});

test("drops the first word of a stalled reply and aborts the provider", async () => {
  let provider;
  let cancelled = false;
  const result = await readChatAttempt(guard => {
    provider = guard.signal;
    return new ReadableStream({
      start(controller) { controller.enqueue(delta("room")); controller.enqueue(delta("   ")); },
      cancel() { cancelled = true; },
    });
  }, signal(), () => assert.fail("No tool should be shown"), timeouts);
  assert.deepEqual(result, { toolSeen: false, reason: "stale-answer" });
  assert.equal(provider.aborted, true);
  assert.equal(cancelled, true);
});

test("hidden reasoning and incomplete tool inputs do not keep a stalled opening alive", async () => {
  const result = await readChatAttempt(() => scripted(
    { type: "reasoning-delta", id: "reason", delta: "still thinking" },
    { type: "tool-input-start", toolCallId: "search", toolName: "web_search" },
    { type: "tool-input-delta", toolCallId: "search", inputTextDelta: "{" },
  ), signal(), () => assert.fail("Partial input should not be shown"), timeouts);
  assert.deepEqual(result, { toolSeen: false, reason: "stale-opening" });
});

test("releases complete short and multilingual replies; discards length-limited output", async () => {
  for (const finishReason of ["stop", "length"]) {
    const result = await readChatAttempt(() => scripted(delta("会議室"), finish(finishReason)), signal(), () => {}, timeouts);
    assert.deepEqual(result, finishReason === "stop"
      ? { toolSeen: false, answer: "会議室" } : { toolSeen: false, reason: "length" });
  }
});

test("keeps the completed tool result and identifies that the turn must not be replayed", async () => {
  const call = { type: "tool-input-available", toolCallId: "search", toolName: "web_search", input: { query: "public topic" } };
  const output = { type: "tool-output-available", toolCallId: "search", output: { sources: ["example"] } };
  const reported = [];
  const result = await readChatAttempt(() => scripted(call, output, delta("The")), signal(), chunk => reported.push(chunk), timeouts);
  assert.deepEqual(result, { toolSeen: true, reason: "stale-answer" });
  assert.deepEqual(reported, [call, output]);
});

test("client cancellation promptly unblocks a waiting reader", async () => {
  const client = new AbortController();
  const result = readChatAttempt(() => scripted(), client.signal, () => {});
  client.abort();
  assert.deepEqual(await result, { toolSeen: false, reason: "cancelled" });
});

test("AI SDK chat streams can be interrupted and reopened for every supported model ID", async () => {
  for (const id of chatModelIds) {
    let calls = 0;
    const provider = createOpenAI({
      apiKey: "mock",
      fetch: async (_url, request) => {
        assert.equal(JSON.parse(request.body).model, id);
        const attempt = ++calls;
        const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({
          id: "fixture", model: id, object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason }],
        })}\n\n`;
        return new Response(new ReadableStream({
          start(controller) {
            const send = (text) => controller.enqueue(new TextEncoder().encode(text));
            send(chunk({ role: "assistant", content: attempt === 1 ? "room" : "Room B" }));
            if (attempt > 1) {
              send(chunk({}, "stop") + "data: [DONE]\n\n");
              controller.close();
            }
          },
        }), { headers: { "content-type": "text/event-stream" } });
      },
    });
    const open = (guard) => streamText({
      model: provider.chat(id), prompt: "Give the room name", maxRetries: 0, abortSignal: guard.signal,
    }).toUIMessageStream({ sendReasoning: false, sendStart: false });
    const interrupted = await readChatAttempt(open, signal(), () => {}, timeouts);
    assert.deepEqual(interrupted, { toolSeen: false, reason: "stale-answer" }, id);
    const recovered = await readChatAttempt(open, signal(), () => {}, timeouts);
    assert.deepEqual(recovered, { toolSeen: false, answer: "Room B" }, id);
    assert.equal(calls, 2, id);
  }
});

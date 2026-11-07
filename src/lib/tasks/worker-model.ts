import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import type { Generate } from "./worker";

/**
 * How the worker reaches a model, resolved like the chat route: DeepSeek Flash is hosted, the other chat models are
 * local Ollama tags, and "server-default" uses MODEL_BASE_URL and MODEL_ID. RICH_CHAT_WORKER_MODEL_BASE_URL sends every
 * job to one OpenAI-compatible server instead (the tests point it at a stub model). Keys come from the environment
 * the launcher gives the worker; they are never stored with a job.
 */
export function workerGenerate(env: Record<string, string | undefined> = process.env, timeoutMs = 120000): Generate {
  return async ({ model, system, prompt, signal }) => {
    const override = env.RICH_CHAT_WORKER_MODEL_BASE_URL;
    const deepSeek = model === "deepseek-flash" && !override;
    const serverDefault = model === "server-default";
    const baseURL = override || (deepSeek ? "https://api.deepseek.com"
      : serverDefault ? env.MODEL_BASE_URL || "https://api.deepseek.com" : "http://127.0.0.1:11434/v1");
    const modelId = serverDefault ? env.MODEL_ID || "deepseek-flash" : model;
    const apiKey = override ? "local" : deepSeek ? env.DEEPSEEK_API_KEY || env.MODEL_API_KEY : serverDefault ? env.MODEL_API_KEY : "local";
    if (!apiKey) throw new Error("This model is not configured for the worker");
    const provider = createOpenAI({ baseURL, apiKey });
    const result = await generateText({
      model: provider.chat(modelId), system, prompt, temperature: 0.2, maxOutputTokens: 3000, maxRetries: 0,
      abortSignal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
    });
    if (result.finishReason !== "stop") throw new Error(`incomplete-response (${result.finishReason})`);
    return result.text;
  };
}

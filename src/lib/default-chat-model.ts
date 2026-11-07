// Server-only configuration. Pass only the model name to the browser.
export function defaultChatModelId() {
  return process.env.MODEL_ID || "deepseek-flash";
}

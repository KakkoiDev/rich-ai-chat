export const chatModelIds = [
  "deepseek-flash",
  "gpt-oss:20b",
  "gemma4:12b-mlx",
  "gemma4:e4b-mlx",
  "gemma4:e2b-mlx",
] as const;

export type ChatModelId = typeof chatModelIds[number];

export const chatModelLabels: Record<ChatModelId, string> = {
  "deepseek-flash": "DeepSeek Flash (hosted)",
  "gpt-oss:20b": "GPT-OSS 20B",
  "gemma4:12b-mlx": "Gemma 4 12B",
  "gemma4:e4b-mlx": "Gemma 4 E4B",
  "gemma4:e2b-mlx": "Gemma 4 E2B",
};

export function isChatModelId(value: string): value is ChatModelId {
  return chatModelIds.some(id => id === value);
}

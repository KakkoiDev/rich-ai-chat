export const maxChatFiles = 3;
export const maxChatFileBytes = 12 * 1024;
export const chatFileExtensions = ".txt,.md,.csv,.tsv,.json,.log,.html,.css,.js,.ts,.jsx,.tsx,.py,.xml,.yaml,.yml";
export const chatFileMime = "text/plain";
export const chatFilePrefix = "data:text/plain;base64,";

export function isChatFilename(name: string) {
  return name.length <= 120 && !/[\x00-\x1f\x7f/\\]/.test(name)
    && chatFileExtensions.split(",").includes(name.slice(name.lastIndexOf(".")).toLowerCase());
}

export function decodeChatText(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > maxChatFileBytes) throw new Error("Files must contain text and be 12 KB or smaller.");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (!text.trim() || text.includes("\0")) throw new Error("Files must contain UTF-8 text.");
  return text;
}

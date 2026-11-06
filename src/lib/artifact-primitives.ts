const shuffleBag = `
globalThis.richChatCreateShuffleBag = function (items) {
  const original = Array.from(new Set(items));
  let remaining = [];
  return function draw() {
    if (!original.length) return undefined;
    if (!remaining.length) remaining = original.slice();
    const index = Math.floor(Math.random() * remaining.length);
    return remaining.splice(index, 1)[0];
  };
};
`;

export function installArtifactPrimitives(document: string, shuffle: boolean) {
  if (!shuffle || !/\brichChatCreateShuffleBag\s*\(/.test(document)) return document;
  return document.replace(/<script\s*>/i, opening => opening + shuffleBag);
}

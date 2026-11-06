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

const sequence = `
globalThis.richChatCreateSequence = function (target) {
  const steps = Array.from(target);
  let index = 0;
  return {
    press(label) {
      if (index === steps.length) return index;
      index = steps[index] === label ? index + 1 : 0;
      return index;
    },
    reset() { index = 0; }
  };
};
`;

export function installArtifactPrimitives(document: string, shuffle: boolean, ordered = false) {
  const code = (shuffle && /\brichChatCreateShuffleBag\s*\(/.test(document) ? shuffleBag : "") +
    (ordered && /\brichChatCreateSequence\s*\(/.test(document) ? sequence : "");
  if (!code) return document;
  return document.replace(/<script\s*>/i, opening => opening + code);
}

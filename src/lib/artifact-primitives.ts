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

const keypad = `
globalThis.richChatCreateKeypad = function () {
  let entry = "", left = 0, operator = "", display = "0", completed = false;
  const operations = {
    "+": (a,b) => a+b, "-": (a,b) => a-b, "*": (a,b) => a*b, "/": (a,b) => a/b
  };
  const aliases = { "−": "-", "×": "*", "÷": "/" };
  function calculate() {
    if (!operator || !entry) return;
    const value = operations[operator](left, Number(entry));
    entry = Number.isFinite(value) ? String(Number(value.toPrecision(12))) : "Error";
    display = entry;
    operator = "";
    completed = true;
  }
  return function press(rawKey) {
    const key = aliases[rawKey] || rawKey;
    if (key === "Clear") {
      entry = ""; left = 0; operator = ""; display = "0"; completed = false;
    } else if (key === "Undo") {
      if (!completed) { entry = entry.slice(0, -1); display = entry || "0"; }
    } else if (key === "=") {
      calculate();
    } else if (Object.hasOwn(operations, key)) {
      calculate();
      if (display !== "Error") {
        left = Number(display);
        operator = key;
        entry = "";
        completed = false;
      }
    } else if (/^[0-9.]$/.test(key)) {
      if (completed) { entry = ""; completed = false; }
      if (entry.length < 14 && (key !== "." || !entry.includes("."))) {
        entry = (key === "." && !entry ? "0" : entry === "0" && key !== "." ? "" : entry) + key;
        display = entry;
      }
    }
    return display;
  };
};
`;

export function installArtifactPrimitives(document: string, shuffle: boolean, ordered = false) {
  const code = (shuffle && /\brichChatCreateShuffleBag\s*\(/.test(document) ? shuffleBag : "") +
    (ordered && /\brichChatCreateSequence\s*\(/.test(document) ? sequence : "");
  if (!code) return document;
  return document.replace(/<script\s*>/i, opening => opening + code);
}

/** Bind the model's layout to the shared keypad without generating event-handler code. */
export function bindArtifactKeypad(markup: string) {
  if (!/<output\b[^>]*\sdata-rich-chat-display(?=[\s=>])/i.test(markup)
    || !/<[a-z][\w-]*\b[^>]*\sdata-rich-chat-keypad(?=[\s=>])/i.test(markup)) return;
  if (/<script\b|\son[a-z]+\s*=/i.test(markup)) return;
  const source = markup.trim().replace(/^```(?:html)?\s*([\s\S]*?)\s*```$/i, "$1").trim()
    .replace(/<\/[a-z][\w-]*$/i, ending => ending + ">");
  const script = `<script>
(() => {
${keypad}
  const press = globalThis.richChatCreateKeypad();
  const display = document.querySelector("output[data-rich-chat-display]");
  for (const button of document.querySelectorAll("[data-rich-chat-keypad] button")) {
    button.addEventListener("click", () => {
      display.textContent = press(button.getAttribute("data-key") || button.textContent.trim());
    });
  }
})();
</script>`;
  if (/<\/body\s*>/i.test(source)) return source.replace(/<\/body\s*>/i, close => script + close);
  return source + script;
}

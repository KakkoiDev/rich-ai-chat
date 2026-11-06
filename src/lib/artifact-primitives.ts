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

function bindMarkup(markup: string, logic: string) {
  if (/<script\b|\son[a-z]+\s*=/i.test(markup)) return;
  const source = markup.trim().replace(/^```(?:html)?\s*([\s\S]*?)\s*```$/i, "$1").trim()
    .replace(/<\/[a-z][\w-]*$/i, ending => ending + ">");
  const script = `<script>(() => {${logic}})();</script>`;
  if (/<\/body\s*>/i.test(source)) return source.replace(/<\/body\s*>/i, close => script + close);
  return source + script;
}

/** Bind the model's layout to the shared keypad without generating event-handler code. */
export function bindArtifactKeypad(markup: string) {
  if (!/<output\b[^>]*\sdata-rich-chat-display(?=[\s=>])/i.test(markup)
    || !/<[a-z][\w-]*\b[^>]*\sdata-rich-chat-keypad(?=[\s=>])/i.test(markup)) return;
  return bindMarkup(markup, `
${keypad}
  const press = globalThis.richChatCreateKeypad();
  const display = document.querySelector("output[data-rich-chat-display]");
  for (const button of document.querySelectorAll("[data-rich-chat-keypad] button")) {
    button.addEventListener("click", () => {
      display.textContent = press(button.getAttribute("data-key") || button.textContent.trim());
    });
  }
`);
}

/** Bind a take-away layout to a shared alternating-turn game with last move winning. */
export function bindArtifactTakeAway(markup: string) {
  if (!/<output\b[^>]*\sdata-rich-chat-count\s*=/i.test(markup)
    || !/\sdata-rich-chat-turn(?=[\s=>])/i.test(markup)
    || !/<button\b[^>]*\sdata-rich-chat-take\s*=/i.test(markup)
    || !/<button\b[^>]*\sdata-rich-chat-restart(?=[\s=>])/i.test(markup)) return;
  return bindMarkup(markup, `
  const display = document.querySelector("output[data-rich-chat-count]");
  const status = document.querySelector("[data-rich-chat-turn]");
  const restart = document.querySelector("button[data-rich-chat-restart]");
  const moves = [...document.querySelectorAll("button[data-rich-chat-take]")];
  const start = Number(display.dataset.richChatCount);
  const players = (display.dataset.players || "A,B").split(",").map(name => name.trim()).filter(Boolean);
  if (!Number.isSafeInteger(start) || start < 1 || players.length < 2) return;
  let left, turn, winner;
  function amount(button) { return Number(button.dataset.richChatTake); }
  function render() {
    display.textContent = String(left);
    status.textContent = winner === null
      ? (status.dataset.turnPrefix || "Turn: ") + players[turn]
      : (status.dataset.winnerTemplate || "{player} wins").replace("{player}", players[winner]);
    for (const button of moves) button.disabled = winner !== null ||
      !Number.isSafeInteger(amount(button)) || amount(button) < 1 || amount(button) > left;
  }
  function reset() { left = start; turn = 0; winner = null; render(); }
  for (const button of moves) {
    button.addEventListener("click", () => {
      if (button.disabled) return;
      left -= amount(button);
      if (left === 0) winner = turn;
      else turn = (turn + 1) % players.length;
      render();
    });
  }
  restart.addEventListener("click", reset);
  reset();
`);
}

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

export function installArtifactPrimitives(document: string, shuffle: boolean) {
  const code = shuffle && /\brichChatCreateShuffleBag\s*\(/.test(document) ? shuffleBag : "";
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
  const valid = key => ["Clear", "Undo", "=", "+", "-", "*", "/", "−", "×", "÷", "."].includes(key)
    || (key !== "" && "0123456789".includes(key) && key.length === 1);
  for (const button of document.querySelectorAll("[data-rich-chat-keypad] button")) {
    const explicit = (button.getAttribute("data-key") || "").trim();
    const label = button.textContent.trim();
    const key = valid(explicit) ? explicit : label;
    if (!valid(key)) continue;
    button.addEventListener("click", () => {
      display.textContent = press(key);
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

export function bindArtifactSequence(markup: string) {
  if (!/\sdata-rich-chat-target\s*=/i.test(markup)
    || !/<button\b[^>]*\sdata-choice\s*=/i.test(markup)
    || !/<button\b[^>]*\sdata-sequence-reset(?=[\s=>])/i.test(markup)
    || !/\sdata-sequence-status(?=[\s=>])/i.test(markup)) return;
  return bindMarkup(markup, `
${sequence}
  const targetNode = document.querySelector("[data-rich-chat-target]");
  const status = document.querySelector("[data-sequence-status]");
  const reset = document.querySelector("button[data-sequence-reset]");
  const target = targetNode.dataset.richChatTarget.split(",").map(value => value.trim()).filter(Boolean);
  const choices = [...document.querySelectorAll("button[data-choice]")];
  const canonical = value => value.trim().toLowerCase();
  if (!target.length || !target.every(value => choices.some(button => canonical(button.dataset.choice) === canonical(value)))) return;
  targetNode.textContent = target.join(", ");
  const success = status.dataset.success || status.textContent.trim();
  status.textContent = "";
  const game = globalThis.richChatCreateSequence(target.map(canonical));
  for (const button of choices) {
    button.addEventListener("click", () => {
      status.textContent = game.press(canonical(button.dataset.choice)) === target.length ? success : "";
    });
  }
  reset.disabled = false;
  reset.addEventListener("click", () => { game.reset(); status.textContent = ""; });
`);
}

const encode = (value: string) => value.replace(/[&<>"']/g, char =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);

export function keypadLayoutMarkup(spec: { title: string; undo: string; clear: string }) {
  const controls = ["7", "8", "9", "÷", "4", "5", "6", "×", "1", "2", "3", "−", "0", ".", "=", "+", "Undo", "Clear"];
  const label = (key: string) => key === "Undo" ? spec.undo : key === "Clear" ? spec.clear : key;
  if (new Set(controls.map(key => label(key).trim().toLowerCase())).size !== controls.length) return;
  return bindArtifactKeypad(`<!doctype html><html><head><title>${encode(spec.title)}</title>
<style>main{max-width:22rem;margin:auto}output{display:block;text-align:right;padding:1rem;font-size:1.5rem}[data-rich-chat-keypad]{display:grid;grid-template-columns:repeat(4,1fr);gap:.4rem}button{min-height:2.5rem}</style></head><body>
<main><h1>${encode(spec.title)}</h1><output data-rich-chat-display aria-live="polite">0</output>
<div data-rich-chat-keypad>${controls.map(key => `<button type="button" data-key="${key}">${encode(label(key))}</button>`).join("")}</div></main></body></html>`);
}

export function takeAwayLayoutMarkup(spec: {
  title: string; count: number; players: string[];
  moves: { label: string; amount: number }[]; restart: string;
}) {
  const canonical = (value: string) => value.trim().toLowerCase();
  const unique = (values: string[]) => new Set(values.map(canonical)).size === values.length;
  if (!Number.isSafeInteger(spec.count) || spec.count < 1 || spec.players.length < 2
    || spec.players.some(player => !player.trim() || player.includes(",")) || !unique(spec.players)
    || !spec.moves.length || spec.moves.some(move => !Number.isSafeInteger(move.amount) || move.amount < 1)
    || !spec.moves.some(move => move.amount <= spec.count)
    || !unique([...spec.moves.map(move => move.label), spec.restart])) return;
  return bindArtifactTakeAway(`<!doctype html><html><head><title>${encode(spec.title)}</title></head><body>
<main><h1>${encode(spec.title)}</h1>
<output data-rich-chat-count="${spec.count}" data-players="${encode(spec.players.join(","))}">${spec.count}</output>
<p role="status" data-rich-chat-turn></p>
<div>${spec.moves.map(move => `<button type="button" data-rich-chat-take="${move.amount}">${encode(move.label)}</button>`).join("")}
<button type="button" data-rich-chat-restart>${encode(spec.restart)}</button></div></main></body></html>`);
}

export function sequenceLayoutMarkup(spec: { title: string; target: string[]; choices: string[]; success: string; reset: string }) {
  const normalize = (label: string) => label.trim().toLowerCase();
  const choices = new Set(spec.choices.map(normalize));
  if (spec.target.some(value => !choices.has(normalize(value))) || choices.size !== spec.choices.length
    || choices.has(normalize(spec.reset))) return;
  return bindArtifactSequence(`<!doctype html><html><head><title>${encode(spec.title)}</title></head><body>
<main><h1>${encode(spec.title)}</h1><p data-rich-chat-target="${encode(spec.target.join(","))}"></p>
<div>${spec.choices.map(choice => `<button type="button" data-choice="${encode(choice)}">${encode(choice)}</button>`).join("")}</div>
<button type="button" data-sequence-reset>${encode(spec.reset)}</button>
<p role="status" data-sequence-status data-success="${encode(spec.success)}"></p></main></body></html>`);
}

export function bindArtifactExpenseList(markup: string) {
  if (!/<input\b[^>]*\sdata-expense-name(?=[\s=>])/i.test(markup)
    || !/<input\b[^>]*\sdata-expense-amount(?=[\s=>])/i.test(markup)
    || !/<button\b[^>]*\sdata-expense-add(?=[\s=>])/i.test(markup)
    || !/\sdata-expense-list(?=[\s=>])/i.test(markup)
    || !/<output\b[^>]*\sdata-expense-total(?=[\s=>])/i.test(markup)) return;
  return bindMarkup(markup, `
  const name = document.querySelector("input[data-expense-name]");
  const amount = document.querySelector("input[data-expense-amount]");
  const add = document.querySelector("button[data-expense-add]");
  const list = document.querySelector("[data-expense-list]");
  const total = document.querySelector("output[data-expense-total]");
  const entries = [];
  const money = cents => (cents / 100).toFixed(2);
  function render() {
    list.replaceChildren();
    entries.forEach((entry, index) => {
      const row = document.createElement(list.matches("ul,ol") ? "li" : "div");
      const label = document.createElement("span");
      label.textContent = entry.name;
      const price = document.createElement("span");
      price.textContent = " " + money(entry.cents) + " ";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = list.dataset.removeLabel || "Remove";
      remove.onclick = () => { entries.splice(index, 1); render(); };
      row.append(label, price, remove);
      list.append(row);
    });
    total.textContent = money(entries.reduce((sum, entry) => sum + entry.cents, 0));
  }
  add.addEventListener("click", event => {
    event.preventDefault();
    const label = name.value.trim();
    const value = Number(amount.value);
    const cents = Math.round(value * 100);
    if (!label || !amount.value.trim() || value < 0 || !Number.isSafeInteger(cents)) return;
    entries.push({ name: label, cents });
    name.value = ""; amount.value = "";
    render();
  });
  render();
`);
}

export function expenseLayoutMarkup(spec: { title: string; name: string; amount: string; add: string; remove: string }) {
  if (spec.name.toLowerCase() === spec.amount.toLowerCase()) return;
  return bindArtifactExpenseList(`<!doctype html><html><head><title>${encode(spec.title)}</title></head><body>
<main><h1>${encode(spec.title)}</h1>
<p><label>${encode(spec.name)} <input data-expense-name aria-label="${encode(spec.name)}"></label></p>
<p><label>${encode(spec.amount)} <input data-expense-amount aria-label="${encode(spec.amount)}" type="number" min="0" step="any"></label></p>
<button type="button" data-expense-add>${encode(spec.add)}</button>
<ul data-expense-list data-remove-label="${encode(spec.remove)}"></ul>
<p>Total: <output aria-label="Total" data-expense-total>0.00</output></p></main></body></html>`);
}

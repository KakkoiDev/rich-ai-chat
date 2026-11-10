/** Match only requests the app's tested mechanics can fulfill as written. */
export function basicRecipe(request: string) {
  const text = request.trim().replace(/\s+/g, " ");
  if (/^(?:please )?(?:make|build|create|open|play) (?:me )?(?:a )?(?:simple )?(?:(?:universal paper[ -]?clips?|paperclip maximizer)(?: clone| game)?)[.!]?$/i.test(text)) {
    return { title: "Paperclip Maximizer", file: "universal-paperclips.html" } as const;
  }
  if (/^(?:please )?(?:make|build|create|open|play) (?:me )?(?:a )?(?:simple )?paper[ -]?clip (?:factory|clicker|game)(?: game)?[.!]?$/i.test(text)) {
    return { title: "Paperclip Factory", file: "paperclip.html" } as const;
  }
  const calculator = /^(?:please )?(?:make|build|create) (?:a )?(?:(?:simple|basic|compact|working) )?calculator(?: (?:i can use right here|with (?:buttons for )?[\w (),+−×÷=.]+))?[.!]?$/i.exec(text);
  if (calculator) {
    const features = text.split(/ with /i)[1]?.replace(/^buttons for /i, "").replace(/[().,+−×÷=]/g, " ").trim();
    if (!features || features.split(/\s+/).every(word => /^(digits|addition|subtraction|multiplication|division|equals|clear|and|decimal|point)$/i.test(word))) {
      return { title: "Calculator starter", file: "calculator.html" } as const;
    }
  }
  const board = /^(?:please )?(?:make|build|create) (?:a )?(?:(?:playable|basic|simple|compact) )?(?:two-player |local )?tic[ -]tac[ -]toe(?: game)?(?:[.!](?: |$)|$)/i.exec(text);
  if (board) {
    const requirements = text.slice(board[0].length).trim().split(/(?<=[.!])\s+/);
    const supported = [
      /^use (?:a )?3 (?:by|x) 3 grid of buttons labeled 1 to 9 in row-major order when empty[.!]?$/i,
      /^x goes first[.!]?$/i,
      /^announce the winner as "x wins" or "o wins"[.!]?$/i,
      /^(?:include|add) a restart button[.!]?$/i,
    ];
    if (requirements.every(requirement => !requirement || supported.some(rule => rule.test(requirement)))) {
      return { title: "Tic-tac-toe starter", file: "tic-tac-toe.html" } as const;
    }
  }
}

/** Recognize a complete request for the standard keypad; leave any extra feature to the model. */
export function basicKeypadSpec(request: string) {
  const sentences = request.trim().replace(/\s+/g, " ").split(/(?<=[.!?])\s+/);
  const head = /^(?:please )?(?:make|build|create) (?:a )?(?:(?:simple|basic|compact|working) )?calculator(?: with ([^!?]+?))?[.!?]?$/i.exec(sentences[0]);
  if (!head || sentences.length > 2) return;
  const features = (head[1] || "").replace(/\.$/, "").split(/,\s*(?:and\s+)?|\s+and\s+/i).map(item => item.trim()).filter(Boolean);
  if (features.some(feature => !/^(?:a visible (?:output|display)|an output element|(?:all )?(?:digit buttons|digits|number keys)|[+−×÷=]|addition|subtraction|multiplication|division|equals|clear|decimal point|undo)$/i.test(feature))) return;
  let undo = features.some(feature => /^undo$/i.test(feature)) ? "Undo" : undefined;
  if (sentences[1]) {
    const action = /^(?:add|include|provide) (?:a button labell?ed (?:"([^"]{1,40})"|'([^']{1,40})'|(\w{1,40}))|(?:an? )?(Undo) button) (?:that |to )?(?:reverses?|undo(?:es)?|removes?|deletes?) (?:the )?(?:(?:most recent|last) digit(?: entry)?|latest digit)(?: (?:without (?:discarding|clearing|losing|resetting)|while (?:keeping|preserving)) (?:the )?pending (?:addition|operator|operation))?[.!?]?$/i.exec(sentences[1]);
    if (!action) return;
    undo = action[1] || action[2] || action[3] || action[4];
  }
  if (undo) return { title: "Calculator", undo, clear: "Clear" };
}

const buildRequest = /^(?:please )?(?:make|build|create|generate) (?:a |an )?/i;
const clauses = (request: string) => request.trim().replace(/\s+/g, " ").split(/(?<=[.!?])\s+/)
  .flatMap(part => part.split(/;\s*/)).map(part => part.replace(/[.!?]$/, ""));

export function basicExpenseSpec(request: string) {
  const [kind, ...rest] = clauses(request);
  if (!buildRequest.test(kind) || !/^(?:simple |basic )?(?:expense|budget) tracker$/i.test(kind.replace(buildRequest, ""))) return;
  let spec;
  let hasTotal = false, hasRemove = false, hasValidation = false;
  for (const part of rest) {
    const fields = /^(?:provide|use|include) (?:two )?(?:fields|inputs) labell?ed ([\w ]{1,40}?) and ([\w ]{1,40}?),? and (?:a )?button labell?ed ([\w ]{1,40})$/i.exec(part);
    const removal = /^(?:each entry has its own|add a per-entry) ([\w ]{1,40}) button$/i.exec(part);
    if (fields && !spec) spec = { title: "Expense tracker", name: fields[1], amount: fields[2], add: fields[3], remove: "Remove" };
    else if (/^(?:list|show) (?:the )?entries and (?:keep|show|display) (?:a )?(?:visible )?(?:running )?total(?: in an output element)?$/i.test(part)) hasTotal = true;
    else if (removal && spec && !hasRemove) { spec.remove = removal[1]; hasRemove = true; }
    else if (/^(?:reject|disallow) negative (?:amounts|values)$/i.test(part)) hasValidation = true;
    else return;
  }
  if (hasTotal && hasRemove && hasValidation) return spec;
}

export function basicTakeAwaySpec(request: string) {
  const [kind, ...rest] = clauses(request);
  if (!buildRequest.test(kind) || !/^(?:simple |two-player )*take[ -]away game(?: from scratch)?$/i.test(kind.replace(buildRequest, ""))) return;
  let count = 0, players: string[] = [], moves: { label: string; amount: number }[] = [], restart = "";
  let lastWins = false, announced: string[] = [];
  for (const part of rest) {
    const start = /^start with (\d{1,6}) (?:tokens|items|counters|stones)$/i.exec(part);
    const order = /^players ([\w-]{1,30}) and ([\w-]{1,30}) alternate, ([\w-]{1,30}) first$/i.exec(part);
    const buttons = /^buttons labell?ed ([\w -]+? \d+) and ([\w -]+? \d+) remove that many (?:tokens|items|counters|stones)$/i.exec(part);
    const win = /^show "([\w-]+) wins" or "([\w-]+) wins"$/i.exec(part);
    const reset = /^(?:disable illegal moves,? and )?(?:add|include) (?:a )?([\w ]{1,40}) button$/i.exec(part);
    if (start && !count) count = Number(start[1]);
    else if (order && !players.length && [order[1], order[2]].includes(order[3]))
      players = order[1] === order[3] ? [order[1], order[2]] : [order[2], order[1]];
    else if (buttons && !moves.length) moves = buttons.slice(1).map(label => ({ label, amount: Number(label.split(" ").at(-1)) }));
    else if (win) announced = win.slice(1);
    else if (reset && !restart) restart = reset[1];
    else if (/^whoever takes the last (?:token|item|counter|stone) wins$/i.test(part)) lastWins = true;
    else if (!/^(?:show|display) the (?:remaining )?count(?: in an output element)?$|^disable illegal moves$/i.test(part)) return;
  }
  if (count && players.length && moves.length && restart && lastWins && announced.every(name => players.includes(name)))
    return { title: "Take-away game", count, players, moves, restart };
}

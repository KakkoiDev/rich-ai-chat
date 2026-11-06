/** Match only requests the app's tested mechanics can fulfill as written. */
export function basicRecipe(request: string) {
  const text = request.trim().replace(/\s+/g, " ");
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

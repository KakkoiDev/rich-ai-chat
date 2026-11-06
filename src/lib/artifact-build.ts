// Like PLH App Blocks, pass the model only the guidance relevant to this build.
const game = /\b(game|pong|angry birds?|slingshot|space invaders?|shooter|flappy bird|tic.tac.toe|platformer|snake)\b/i;
const app = /\b(app|calculator|timer|dashboard|quiz|tracker|editor|tool|form|planner|converter|notes|to.do|counter|simulator|calendar|website|kanban|interface|web page|drawing pad|flashcards)\b/i;
const build = /^\s*(?:(?:please|can you|could you)\s+)*(?:make|build|create|generate|implement|design|code|write)\b/i;

export function wantsShuffleBag(request: string) {
  return /\brandom(?:ly)?\b/i.test(request) && /\b(?:without repeats?|without replacement|(?:do not|never) repeat|no repeats?|until all)\b/i.test(request);
}

export const isSequenceGame = (request: string) => /\bsequence\s+(?:puzzle|game)\b/i.test(request);

export function artifactBuildGuide(request: string, useShuffleHelper = false, useSequenceHelper = false) {
  if (!build.test(request) || /\bnative\s+openui\b/i.test(request)) return undefined;
  // An explicit instruction against HTML must not itself trigger HTML generation.
  request = request.replace(/\b(?:do not|don't|never)\s+(?:use|make|build|generate)\s+(?:an?\s+)?html(?:\s+(?:app|artifact))?\b/gi, "");
  if (game.test(request)) {
    if (isSequenceGame(request)) return useSequenceHelper
      ? "Game card: show the full target array. Initialize the built-in richChatCreateSequence(target) once. Its press(label) returns the new progress index, or zero after a wrong choice. Reset calls sequence.reset() and clears the status."
      : "Game card: show the whole target array. Wire every choice button to the same choose(label) handler, passing its own label. Compare the clicked label (a string) to target[index] (a string), never the numeric index itself. If wrong, reset index and clear success; if right, increment index once and show success exactly when it reaches target.length. Reset clears the index and success.";
    if (/\btake[ -]away\b/i.test(request)) return "Game card: use one move(amount) handler and one render() function. A legal move subtracts amount, sets winner to current player if count reaches zero, otherwise switches turns. Then call render() on EVERY legal move. render() writes the remaining token count to the output element, writes the current turn or winner to a separate status paragraph, and disables illegal moves. Restart restores count, player and winner, then calls render().";
    const base = "Game card: implement start, play and restart first. Use a fixed timestep or elapsed time, consistent rendering and collision geometry, and pointer controls where practical. For board games, put labeled controls in the initial HTML, attach event listeners after those controls exist, and reset all board and turn state on restart. Given a new game, when the player acts, then show an observable gameplay change.";
    if (!/\btic.tac.toe\b/i.test(request)) return base;
    return base + " Tic-tac-toe recipe: keep a nine-element board initialized to empty strings. Convert visible cell labels 1–9 to array indices 0–8. Ignore occupied cells and moves after game over. Place the current mark, then check these zero-based winning lines before switching turns: [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]]. If any line is all the current mark, show that mark as the winner. Otherwise check for a draw, then switch turns. On reset restore labels, clear the board and result, and let X go first.";
  }
  if (/\bcalculator\b/i.test(request)) return (/\bundo\b/i.test(request) ? "Undo recipe: current entry is a string. Append each typed digit. Undo sets entry = entry.slice(0, -1). Keep the saved left operand and operator. Equals uses Number(entry) as the right operand; never reuse a stale number. " : "") + "App card: one display and exactly one button per requested key. Digit buttons means all ten digits, 0 through 9. Clear resets the entry, operator and saved operand. Honor the requested features without adding extra keys.";
  if (/\b(?:expense tracker|budget tracker)\b/i.test(request)) return "App card: use plain inputs with matching label for and input id. Use a button with type=button and a click listener; no form wrapper or submit handler is needed. On click, read the inputs, validate the amount, push the entry, and call render(). render() lists the current entries and sets output.textContent to their numeric sum. Removal also calls render(). Insert user text with textContent.";
  if (/\b(?:converter|conversion)\b/i.test(request)) return "App card: put the requested input label in a real label element linked by for/id; use exactly the requested wording with no added punctuation. Keep the input and converted result separate. Validate finite numbers, preserve negative and fractional inputs, and clear both the field and result when asked.";
  if (/\bbutton\s+(?:that|which|to)\s+(?:\w+\s+){0,2}(?:shows?|displays?|picks?|draws?|chooses?|generates?|reveals?|changes?|updates?|toggles?|adds?|removes?|copies?)\b/i.test(request)) {
    const noRepeats = wantsShuffleBag(request);
    return "Interactive card: put the requested button and result area in the HTML. Update the visible result on each click. Use the supplied data or label bundled examples as a sample." +
      (noRepeats ? (useShuffleHelper
        ? " Built-in helper: set const draw = richChatCreateShuffleBag(items) once, outside the click handler. Each click sets the output text to draw(). It draws without replacement and starts the next cycle automatically. Do not implement or call a separate shuffle."
        : " Keep an array of remaining items. On every click, if empty copy the full list first; then pick a random index in the remaining array, remove one item with splice, and display only that item. There is no separate reset click or cycle message.") : "");
  }
  if (app.test(request)) return "App card: separate state changes from rendering, label controls, and handle invalid input. Given the initial screen, when the user completes the main action, then show the result and let them clear or reset it if appropriate.";
  if (/\b(?:html|css|javascript|interactive|playable)\b/i.test(request)) return "Interactive card: implement the main user action and a visible result before adding polish.";
  return undefined;
}

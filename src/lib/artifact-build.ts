// Like PLH App Blocks, pass the model only the guidance relevant to this build.
const game = /\b(game|pong|angry birds?|slingshot|space invaders?|shooter|flappy bird|tic.tac.toe|platformer|snake)\b/i;
const app = /\b(app|calculator|timer|dashboard|quiz|tracker|editor|tool|form|planner|converter|notes|to.do|counter|simulator|calendar|website|kanban|interface|web page|drawing pad|flashcards)\b/i;
const build = /^\s*(?:(?:please|can you|could you)\s+)*(?:make|build|create|generate|implement|design|code|write)\b/i;

export function artifactBuildGuide(request: string) {
  if (!build.test(request)) return undefined;
  if (game.test(request)) {
    const base = "Game card: implement start, play and restart first. Use a fixed timestep or elapsed time, consistent rendering and collision geometry, and pointer controls where practical. For board games, put labeled controls in the initial HTML, attach event listeners after those controls exist, and reset all board and turn state on restart. Given a new game, when the player acts, then show an observable gameplay change.";
    if (!/\btic.tac.toe\b/i.test(request)) return base;
    return base + " Tic-tac-toe recipe: keep a nine-element board initialized to empty strings. Convert visible cell labels 1–9 to array indices 0–8. Ignore occupied cells and moves after game over. Place the current mark, then check these zero-based winning lines before switching turns: [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]]. If any line is all the current mark, show that mark as the winner. Otherwise check for a draw, then switch turns. On reset restore labels, clear the board and result, and let X go first.";
  }
  if (/\bcalculator\b/i.test(request)) return "App card: build one display and exactly one button per requested key. Use simple JavaScript variables for the first operand, operator and typed digits, explicit arithmetic, and a Clear button that resets all state. Honor the requested features without adding extra keys.";
  if (app.test(request)) return "App card: separate state changes from rendering, label controls, and handle invalid input. Given the initial screen, when the user completes the main action, then show the result and let them clear or reset it if appropriate.";
  if (/\b(?:html|css|javascript|interactive|playable)\b/i.test(request)) return "Interactive card: implement the main user action and a visible result before adding polish.";
  return undefined;
}

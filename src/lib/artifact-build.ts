// Like PLH App Blocks, pass the model only the guidance relevant to this build.
const game = /\b(game|pong|angry birds?|slingshot|space invaders?|shooter|flappy bird|tic.tac.toe|platformer|snake)\b/i;
const app = /\b(app|calculator|timer|dashboard|quiz|tracker|editor|tool|form|planner|converter|notes|to.do|counter|simulator|calendar|website|kanban|interface|web page|drawing pad|flashcards)\b/i;
const build = /^\s*(?:(?:please|can you|could you)\s+)*(?:make|build|create|generate|implement|design|code|write)\b/i;

export function artifactBuildGuide(request: string) {
  if (!build.test(request)) return undefined;
  if (game.test(request)) return "Game card: implement start, play and restart first. Use a fixed timestep or elapsed time, consistent rendering and collision geometry, and pointer controls where practical. Given a new game, when the player acts, then show an observable gameplay change.";
  if (app.test(request)) return "App card: separate state changes from rendering, label controls, and handle invalid input. Given the initial screen, when the user completes the main action, then show the result and let them clear or reset it if appropriate.";
  if (/\b(?:html|css|javascript|interactive|playable)\b/i.test(request)) return "Interactive card: implement the main user action and a visible result before adding polish.";
  return undefined;
}

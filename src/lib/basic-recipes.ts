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

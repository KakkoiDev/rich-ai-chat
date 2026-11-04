import { Script } from "node:vm";

/** Check the preview contract without executing generated code. */
export function checkArtifact(document: string): string | undefined {
  const scripts = [...document.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
  if (scripts.length !== (document.match(/<script\b/gi)?.length ?? 0))
    return "HTML: close every script tag.";
  for (const [i, [, attributes, source]] of scripts.entries()) {
    if (/\bsrc\s*=/i.test(attributes)) return `Script ${i + 1}: include JavaScript inline; the preview blocks external scripts.`;
    if (/\btype\s*=/i.test(attributes) && !/\btype\s*=\s*["']?(?:text|application)\/javascript/i.test(attributes)) continue;
    // Catch common direct uses that the preview's CSP rejects at runtime.
    const dynamic = /\b(?:eval|Function)\s*\(/.exec(source);
    if (dynamic) {
      const line = source.slice(0, dynamic.index).split("\n").length;
      return `Script ${i + 1}, line ${line}: the preview blocks eval and Function. Implement the behavior directly.`;
    }
    const filename = `artifact-script-${i + 1}.js`;
    try {
      new Script(source, { filename });
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      const line = error.stack?.match(/artifact-script-\d+\.js:(\d+)/)?.[1];
      return `Script ${i + 1}${line ? `, line ${line}` : ""}: ${error.message}.`;
    }
  }
}

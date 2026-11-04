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


/** Extract a single HTML document; serialization into OpenUI is the host's job. */
export function readArtifact(text: string) {
  const document = text.trim().replace(/^```(?:html)?\s*([\s\S]*?)\s*```$/i, "$1").trim();
  if (document.length > 32000 || !/^(?:<!doctype html>\s*)?<html(?:\s[^>]*)?>/i.test(document)
    || !/<\/html>$/i.test(document) || !/<body\b/i.test(document) || !/<script\b/i.test(document)) {
    return { error: "Return one complete HTML document with a body and inline script." } as const;
  }
  const failure = checkArtifact(document);
  if (failure) return { error: failure } as const;
  const title = document.match(/<title>\s*([^<]{1,160})<\/title>/i)?.[1].trim() || "Interactive preview";
  return { title, document } as const;
}

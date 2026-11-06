import { Script } from "node:vm";

/** Check the preview contract without executing generated code. */
export function checkArtifact(document: string): string | undefined {
  const scripts = [...document.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
  if (scripts.length !== (document.match(/<script\b/gi)?.length ?? 0))
    return "HTML: close every script tag.";
  const markup = document.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "");
  if ((markup.match(/<style(?:\s|>)/gi)?.length ?? 0) !== (markup.match(/<\/style\s*>/gi)?.length ?? 0))
    return "HTML: close every style tag; an open style tag hides the rest of the page.";
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
export function readArtifact(text: string, allowFragment = false) {
  let document = text.trim().replace(/^```(?:html)?\s*([\s\S]*?)\s*```$/i, "$1").trim();
  if (allowFragment && /^<[a-z][\w-]*(?:\s|>)/i.test(document)
    && !/<\/?(?:html|head|body)\b|<!doctype/i.test(document)
    && /<\/script\s*>$/i.test(document)) {
    document = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${document}</body></html>`;
  }
  if (document.length > 32000 || !/^(?:<!doctype html>\s*)?<html(?:\s[^>]*)?>/i.test(document)
    || !/<\/html>$/i.test(document) || !/<body\b/i.test(document) || !/<script\b/i.test(document)) {
    return { error: "Return one complete HTML document with a body and inline script." } as const;
  }
  const failure = checkArtifact(document);
  if (failure) return { error: failure } as const;
  const title = document.match(/<title>\s*([^<]{1,160})<\/title>/i)?.[1].trim() || "Interactive preview";
  return { title, document } as const;
}

/** Validate explicit element requests without prescribing markup for ordinary visual requests. */
export function checkArtifactRequest(document: string, request: string): string | undefined {
  if (requiresArtifactOutput(request) && !/<output(?:\s|>)/i.test(document)
    && !/createElement\(\s*["']output["']\s*\)/i.test(document)) {
    return "The request explicitly requires an HTML <output> element. Use it for the requested visible value.";
  }
  const buttons = [...document.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button\s*>/gi)]
    .map(([, label]) => label.replace(/<[^>]*>/g, "").trim());
  const named = artifactButtonLabels(request);
  // Also accept labels present as string literals for controls created in JavaScript.
  const literal = (label: string) => ['"', "'", "`"].some(quote => document.includes(quote + label + quote));
  const missing = named.filter(label => !buttons.includes(label) && !literal(label));
  if (missing.length) return "Add buttons with these exact labels: " + missing.map(label => JSON.stringify(label)).join(", ") + ".";
  if (/\bcalculator\b/i.test(request) && /\bdigit buttons\b/i.test(request)) {
    const digits = Array.from({ length: 10 }, (_, i) => String(i));
    if (buttons.filter(label => /^\d$/.test(label)).length >= 2
      && !/(?:0123456789|9876543210|length\s*:\s*10\b)/.test(document)) {
      const absent = digits.filter(label => !buttons.includes(label) && !literal(label));
      if (absent.length) return "Include every digit button 0–9. Missing: " + absent.join(", ") + ".";
    }
  }
}

export const requiresArtifactOutput = (request: string) => /\boutput element\b|<output>/i.test(request);

export function artifactButtonLabels(request: string) {
  const names = new Set<string>();
  // Only lift literal-looking labels from explicit control requests, not descriptions of behavior.
  for (const match of request.matchAll(/\b(?:label the button|buttons? labell?ed)\s+/gi)) {
    const rest = request.slice(match.index + match[0].length);
    const quoted = /^(?:"([^"\r\n]{1,40})"|'([^'\r\n]{1,40})')/.exec(rest);
    if (quoted) {
      names.add(quoted[1] ?? quoted[2]);
      continue;
    }
    const phrase = rest.split(/[.,;!?\r\n]|\s+(?:that|which|to|remove|add|show|displays?|opens?)\b|\s+and\s+(?=[a-z])/)[0].trim();
    for (const label of phrase.split(" and ")) {
      if (/^[A-Z][A-Za-z0-9]*(?: [A-Za-z0-9]+){0,3}$/.test(label)) names.add(label);
    }
  }
  for (const [, label] of request.matchAll(/\b(?:add|provide|include|use)\s+(?:a|an)\s+([A-Z][a-z]+) button\b/gi))
    if (/^[A-Z]/.test(label)) names.add(label);
  return [...names];
}

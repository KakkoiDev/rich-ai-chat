/**
 * One definition of what a generated app runs with, shared by the in-chat preview and the downloaded file, so an
 * exported app behaves exactly like the preview: same content policy, same source clean-up, same bundled engine.
 */
export const artifactPolicy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'; worker-src 'none'";

export const engineMarker = "<!-- rich-ai-chat:littlejs -->";

/** Some models emit a line continuation or double-escape inline handler quotes. */
export function artifactSource(document: string) {
  return document.replace(/\\\r?\n/g, "")
    .replace(/(<[a-z][^<>]*?\s)(on[a-z]+\s*=\s*)\\+"([^"<>]*?)\\+"/gi, '$1$2"$3"');
}

/** An inline script tag for the bundled engine; `</script` inside it would end the tag early. */
export function engineScript(engine: string) {
  return `<script>${engine.replace(/<\/script/gi, "<\\/script")}</script>`;
}

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * A standalone HTML file for a generated app: no preview monitor, the preview's content policy, and the LittleJS engine
 * inlined with its licence when the app uses it. The output depends only on the input, so the same app exports to the
 * same bytes.
 */
export function exportArtifact({ title, document, engine, engineLicense }: {
  title: string; document: string; engine?: string; engineLicense?: string;
}) {
  const source = artifactSource(document);
  const needsEngine = source.includes(engineMarker);
  if (needsEngine && !(engine && engineLicense)) throw new Error("This app needs the bundled LittleJS engine and its licence.");
  const licence = needsEngine ? `<!-- LittleJS 1.27.0 (bundled):\n${engineLicense!.trim().replace(/--/g, "- -")}\n-->\n` : "";
  const head = [
    "<!doctype html>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta http-equiv="Content-Security-Policy" content="${artifactPolicy}">`,
    ...(/<title\b/i.test(source) ? [] : [`<title>${escapeHtml(title)}</title>`]),
    "<!-- Exported from Rich AI Chat. Self-contained: it makes no network requests and works offline. -->",
  ].join("\n");
  return `${head}\n${licence}${needsEngine ? engineScript(engine!) + "\n" : ""}${source}\n`;
}

/** "Tip calculator" + digest -> "tip-calculator-1a2b3c4d.html"; titles without letters or digits become "app". */
export function exportFilename(title: string, digest: string) {
  const slug = title.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 48).replace(/-+$/, "");
  return `${slug || "app"}-${digest.slice(0, 8)}.html`;
}

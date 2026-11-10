import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { request } from "node:https";

const blocked = new BlockList();
for (const [address, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 3],
] as const) blocked.addSubnet(address, bits);

export function publicPageUrl(raw: string) {
  const url = new URL(raw);
  const host = url.hostname.replace(/\.$/, "");
  if (raw.length > 2048 || url.protocol !== "https:" || url.username || url.password || url.port
    || !host.includes(".") || isIP(host) || host.endsWith(".localhost")) throw Error("Use a public HTTPS page URL.");
  url.hash = "";
  return url;
}

export function pageSummaryUrl(text: string) {
  if (!/\b(?:summari[sz]e|summerize|summary|recap|read)\b|要約/i.test(text)) return;
  const matches = text.match(/https?:\/\/[^\s<>"`]+/gi);
  if (matches?.length === 1) return matches[0].replace(/[)\].,!?]+$/, "");
}

export function extractPageText(html: string) {
  const clean = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style|noscript|template|svg|nav|footer|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  const title = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(clean)?.[1];
  const body = /<article\b[^>]*>([\s\S]*?)<\/article\s*>/i.exec(clean)?.[1]
    ?? /<main\b[^>]*>([\s\S]*?)<\/main\s*>/i.exec(clean)?.[1]
    ?? /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(clean)?.[1] ?? clean;
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", nbsp: " ", quot: '"', apos: "'" };
  const plain = (value: string) => value.replace(/<rt\b[^>]*>[\s\S]*?<\/rt\s*>/gi, "")
    .replace(/<\/(?:p|div|h[1-6]|li|section)>|<br\b[^>]*>/gi, "\n").replace(/<[^>]*>/g, "")
    .replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (whole, entity: string) => {
      if (!entity.startsWith("#")) return Object.hasOwn(entities, entity) ? entities[entity] : whole;
      const number = /^#x/i.test(entity) ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : whole;
    }).replace(/[^\S\r\n]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
  const text = plain(body);
  // Some public pages return a preview followed by an access screen. Never accept terms on the user's behalf.
  const gate = /(?:to (?:view|continue to|access) (?:this|the) (?:page|article)[^\n]{0,180}(?:agree|accept|sign in|check the box)|(?:sign in|subscribe) to (?:continue reading|read (?:the|this) (?:full )?article)|(?:この|全文の?)?(?:ページ|記事|全文)(?:を|の)?(?:見る|読む|閲覧する|表示する)には[^\n]{0,180}(?:ご利用|同意|チェック|ログイン|登録))/i.exec(text);
  const fallback = { title: plain(title ?? "").slice(0, 200), text: (gate ? text.slice(0, gate.index).trim() : text).slice(0, 16000), partial: Boolean(gate) };
  // Keep explicit access gates and short articles on the conservative extraction path.
  if (gate || text.length < 500) return fallback;
  try {
    const { document } = parseHTML(clean);
    for (const ruby of document.querySelectorAll("rt, rp")) ruby.remove();
    const article = new Readability(document, { maxElemsToParse: 12000 }).parse();
    const readable = article?.content && plain(article.content);
    if (readable && readable.length >= 500) return {
      title: (article.title || fallback.title).slice(0, 200), text: readable.slice(0, 16000), partial: false,
    };
  } catch {
    // Malformed or unusually large HTML still gets the original bounded extraction.
  }
  return fallback;
}

/** Resolve and pin the public address for each hop. Never send cookies or follow redirects unchecked. */
export async function readPublicPage(raw: string, signal: AbortSignal) {
  const budget = AbortSignal.any([signal, AbortSignal.timeout(10000)]);
  let url = publicPageUrl(raw);
  for (let hop = 0; hop < 4; hop++) {
    const addresses = await new Promise<{ address: string; family: number }[]>((resolve, reject) => {
      const abort = () => reject(budget.reason);
      if (budget.aborted) { abort(); return; }
      budget.addEventListener("abort", abort, { once: true });
      void lookup(url.hostname, { all: true, family: 4 }).then(resolve, () => reject(Error("The site address could not be resolved.")))
        .finally(() => budget.removeEventListener("abort", abort));
    });
    budget.throwIfAborted();
    if (!addresses.length || addresses.some(({ address }) => blocked.check(address))) throw Error("The page does not resolve to a public address.");
    const address = addresses[0].address;
    const result = await new Promise<{ redirect: string } | { html: string; plain: boolean }>((resolve, reject) => {
      const req = request(url, {
        signal: budget, agent: false, family: 4,
        lookup: (_host, options, callback) => options.all
          ? callback(null, [{ address, family: 4 }]) : callback(null, address, 4),
        headers: { Accept: "text/html, text/plain", "User-Agent": "RichAIChat/1.0" },
      }, response => {
        response.on("error", reject);
        const status = response.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
          response.destroy(); resolve({ redirect: response.headers.location }); return;
        }
        const type = response.headers["content-type"] ?? "";
        if (status < 200 || status >= 300 || !/^text\/(html|plain)\b/i.test(type)) {
          response.destroy(); reject(Error(`The site did not return a readable page (HTTP ${status}).`)); return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 1024 * 1024) { reject(Error("The page is too large to read.")); response.destroy(); }
          else chunks.push(chunk);
        });
        response.on("end", () => resolve({ html: Buffer.concat(chunks).toString("utf8"), plain: /^text\/plain\b/i.test(type) }));
      });
      req.on("error", reject);
      req.end();
    });
    if ("redirect" in result) { url = publicPageUrl(new URL(result.redirect, url).href); continue; }
    const page = result.plain ? { title: "", text: result.html.trim().slice(0, 16000), partial: false } : extractPageText(result.html);
    if (!page.partial && page.text.length < 30) throw Error("The page did not contain enough readable text.");
    return { ...page, url: url.href };
  }
  throw Error("The site redirected too many times.");
}

import { createHash } from "node:crypto";
import { hostStyle } from "@/lib/host-style";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { artifactPolicy, artifactSource, engineMarker, exportArtifact } from "@/lib/artifact-export";
import {
  installedAppHead, installedAppIcons, installedAppId, installedAppManifest, installedAppPolicy, installedAppWorker, networkFeatures,
} from "@/lib/app-install";
import { exportOrigin, exportsDirectory, writeInstalledApp } from "@/lib/app-install-store";

const error = (message: string, status: number, code?: string) => Response.json({ error: message, code }, { status });
const publicFile = (...parts: string[]) => readFile(join(process.cwd(), "public", ...parts));

/**
 * "Install as app": write a generated app into the export folder as /apps/<id>/ (page, manifest, icons, offline
 * worker) and answer with its address on the export origin. Same-origin requests only, like the chat itself.
 */
export async function POST(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return error("Forbidden", 403);
  const origin = exportOrigin();
  if (!origin) return error("Install as app isn't set up on this server: the owner sets RICH_CHAT_EXPORT_ORIGIN (docs/INSTALLABLE-APPS.md).", 503, "not-configured");
  const raw = await request.text();
  if (raw.length > 80000) return error("This app is too large to install.", 413);
  const body = (() => { try { return JSON.parse(raw) as unknown; } catch { return null; } })();
  const { title, document } = (body ?? {}) as { title?: unknown; document?: unknown };
  if (typeof title !== "string" || typeof document !== "string" || title.length > 200 || !document.trim() || document.length > 32000)
    return error("Send the app's title and source.", 400);

  try {
    const needsEngine = artifactSource(document).includes(engineMarker);
    const [engine, engineLicense] = needsEngine
      ? (await Promise.all([publicFile("vendor", "littlejs-1.27.0.min.js"), publicFile("vendor", "LICENSE.littlejs")])).map(String)
      : [];
    const html = exportArtifact({ title, document, engine, engineLicense, policy: installedAppPolicy(artifactPolicy), head: [...installedAppHead, hostStyle] });
    const id = installedAppId(title, createHash("sha256").update(html).digest("hex"));
    const network = networkFeatures(artifactSource(document));
    const files: Record<string, string | Uint8Array> = {
      "index.html": html,
      "manifest.webmanifest": installedAppManifest({ id, title, network }),
      "sw.js": installedAppWorker(id),
    };
    for (const icon of installedAppIcons) files[icon.file] = await publicFile("icons", icon.source);
    await writeInstalledApp(exportsDirectory(), id, files);
    return Response.json({ id, url: `${origin}/apps/${id}/`, needsConnection: network.length > 0, network });
  } catch (cause) {
    console.warn("Install as app failed:", cause instanceof Error ? cause.message : cause);
    return error("Could not write the app. Try again.", 500);
  }
}

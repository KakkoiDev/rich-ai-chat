import { mkdir, mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Where installed apps are written and where they are served from. RICH_CHAT_EXPORTS_DIR is the folder the Caddy site
 * serves (default: the app's data folder); RICH_CHAT_EXPORT_ORIGIN is that site's address as people reach it, a
 * different origin from the chat. Without an origin, "Install as app" says it is not set up and writes nothing.
 */
export function exportsDirectory(configured = process.env.RICH_CHAT_EXPORTS_DIR) {
  return configured || join(homedir(), "Library", "Application Support", "Rich AI Chat", "exports");
}

/** "https://host:3216/" -> "https://host:3216"; anything but a bare http(s) origin is refused. */
export function exportOrigin(configured = process.env.RICH_CHAT_EXPORT_ORIGIN) {
  if (!configured) return undefined;
  try {
    const url = new URL(configured);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

const exists = (path: string) => stat(path).then(() => true, () => false);

/**
 * Write one app folder, <root>/apps/<id>/, all at once: the files go into a hidden folder first (the site hides dot
 * files) and are renamed into place, so the site never serves half an app. Ids are content hashes, so an existing
 * folder already holds the same app and is kept.
 */
export async function writeInstalledApp(root: string, id: string, files: Record<string, string | Uint8Array>) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error("Invalid app id");
  for (const name of Object.keys(files))
    if (!/^[a-z0-9][a-z0-9.-]*(?:\/[a-z0-9][a-z0-9.-]*)*$/i.test(name) || name.split("/").includes("..")) throw new Error("Invalid file name");
  const apps = join(root, "apps");
  const target = join(apps, id);
  await mkdir(apps, { recursive: true });
  if (await exists(target)) return "exists" as const;
  const incoming = await mkdtemp(join(apps, ".incoming-"));
  try {
    for (const [name, data] of Object.entries(files)) {
      await mkdir(dirname(join(incoming, name)), { recursive: true });
      await writeFile(join(incoming, name), data);
    }
    await rename(incoming, target);
    return "written" as const;
  } catch (error) {
    await rm(incoming, { recursive: true, force: true });
    if (await exists(target)) return "exists" as const; // another request wrote the same app first
    throw error;
  }
}

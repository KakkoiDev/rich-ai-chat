import { chromium, type Browser } from "playwright-core";
import { z } from "zod";
import { artifactPolicy, engineMarker } from "./artifact-export.ts";

const name = z.string().trim().min(1).max(70);
export const browserPlan = z.object({
  checks: z.array(z.object({
    intent: z.enum(["change", "preserve"]),
    label: name,
    steps: z.array(z.object({
      action: z.enum(["click", "fill", "advance", "visible", "text", "unchecked"]),
      role: z.enum(["button", "checkbox", "textbox", "spinbutton", "status", "heading", "img", "text"]),
      name: z.string().max(70),
      value: z.string().max(120),
      ms: z.number().int().min(0).max(3000),
    })).min(1).max(6),
  })).max(3),
});
type Plan = z.infer<typeof browserPlan>;
type Check = Plan["checks"][number];

export function usableChecks(plan: Plan) {
  return plan.checks.filter(check => check.steps.some(step => ["visible", "text", "unchecked"].includes(step.action))
    && check.steps.every(step => step.action === "advance" || Boolean(step.name.trim())));
}

const escapeAttribute = (html: string) => html.replaceAll("&", "&amp;").replaceAll('"', "&quot;")
  .replaceAll("<", "&lt;").replaceAll(">", "&gt;");

async function runCheck(browser: Browser, document: string, check: Check | undefined) {
  const context = await browser.newContext({ offline: true, serviceWorkers: "block", acceptDownloads: false });
  try {
    await context.route("**/*", route => route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(1200);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message.slice(0, 140)));
    const source = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${artifactPolicy}">${document}`;
    await page.setContent(`<iframe style="width:100vw;height:100vh;border:0" title="Verification preview" sandbox="allow-scripts" srcdoc="${escapeAttribute(source)}"></iframe>`, { timeout: 1600 });
    const frame = page.frameLocator("iframe");
    for (const step of check?.steps ?? []) {
      if (step.action === "advance") { await new Promise(resolve => setTimeout(resolve, step.ms)); continue; }
      const target = step.role === "text" ? frame.getByText(step.name, { exact: true })
        : frame.getByRole(step.role, { name: step.name, exact: true });
      if (step.action === "click") await target.click();
      else if (step.action === "fill") await target.fill(step.value);
      else {
        await target.waitFor({ state: "visible" });
        if (step.action === "text" && (await target.innerText()).trim() !== step.value) return `“${step.name}” did not display the expected text.`;
        if (step.action === "unchecked" && (step.role !== "checkbox" || await target.isChecked())) return `“${step.name}” was not unchecked.`;
      }
    }
    return errors[0] ? `Preview JavaScript error: ${errors[0]}` : undefined;
  } catch {
    return check ? "A required control could not be found or used." : "The preview did not load.";
  } finally {
    await context.close();
  }
}

let running = false;

/** Only the explicitly configured browser can run app code. Never fall back to an unsandboxed launch. */
export async function checkRevisionInBrowser(executablePath: string, original: string, candidate: string, checks: Check[], signal: AbortSignal) {
  if (original.includes(engineMarker) || candidate.includes(engineMarker)) return { skipped: "Bundled engine previews are not supported yet.", passed: 0 };
  if (running || signal.aborted) return { skipped: "The verification browser was busy or the revision ended.", passed: 0 };
  running = true;
  let browser: Browser | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => { void browser?.close().catch(() => {}); };
  signal.addEventListener("abort", stop, { once: true });
  try {
    browser = await chromium.launch({ executablePath, chromiumSandbox: true, timeout: 5000 });
    if (signal.aborted) return { skipped: "The revision ended.", passed: 0 };
    timer = setTimeout(stop, 8500);
    const baseline = await runCheck(browser, original, undefined);
    const error = await runCheck(browser, candidate, undefined);
    if (!browser.isConnected()) return { skipped: "Browser verification reached its time limit.", passed: 0 };
    if (error && error !== baseline) return { problem: error, passed: 0 };
    let passed = 0;
    for (const check of checks) {
      const before = await runCheck(browser, original, check);
      if (check.intent === "preserve" && before) continue;
      const after = await runCheck(browser, candidate, check);
      if (!browser.isConnected()) return { skipped: "Browser verification reached its time limit.", passed };
      if (after) return { problem: `${check.label}: ${after}`, passed };
      passed++;
    }
    if (!browser.isConnected()) return { skipped: "Browser verification reached its time limit.", passed };
    return { passed };
  } catch {
    return { skipped: "The sandboxed browser could not complete verification.", passed: 0 };
  } finally {
    if (timer) clearTimeout(timer);
    signal.removeEventListener("abort", stop);
    await browser?.close().catch(() => {});
    running = false;
  }
}

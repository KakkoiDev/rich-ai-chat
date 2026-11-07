import { kakkoiInlineCss } from "@/generated/kakkoi-inline";

/**
 * The Kakkoi inline subset (visual-core): black and white, square, 44 px controls, system fonts. The host puts it in
 * every generated app's head, the preview and both exports, before the app's own markup so the app's styles still win.
 * The model never writes it, so it costs nothing against the app size budget.
 */
export const hostStyle = `<style id="kakkoi-inline">${kakkoiInlineCss}</style>`;

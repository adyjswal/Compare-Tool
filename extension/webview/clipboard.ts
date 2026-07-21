/**
 * Copy text to the clipboard from the webview.
 *
 * Prefers the async Clipboard API (available in the VS Code webview sandbox),
 * and falls back to a hidden-textarea + `execCommand("copy")` if it's blocked —
 * so copy works regardless of focus/permission quirks.
 */
export async function copyToClipboard(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // fall through to the legacy path
  }
  legacyCopy(text);
}

function legacyCopy(text: string): void {
  const area = document.createElement("textarea");
  area.value = text;
  area.style.cssText = "position:fixed;top:-1000px;left:-1000px;opacity:0;";
  document.body.appendChild(area);
  area.focus();
  area.select();
  try {
    document.execCommand("copy");
  } catch {
    // Nothing more we can do; silently give up.
  }
  document.body.removeChild(area);
}

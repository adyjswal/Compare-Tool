import { basename } from "node:path";
import * as vscode from "vscode";
import type { DiffResult, FileDocument } from "@large-file-compare/engine";
import type { DiffResultMessage, WebviewToHostMessage } from "../protocol";

/**
 * Manages the single webview panel that shows comparison results.
 *
 * We keep one panel and reuse it across comparisons. Because the webview's
 * script may not have attached its message listener by the time we post the
 * first result, we hold the latest message and (re)send it when the webview
 * tells us it's `ready`.
 */

let currentPanel: vscode.WebviewPanel | undefined;
let latestMessage: DiffResultMessage | undefined;

/** Open (or reuse) the diff panel and show a comparison result in it. */
export function showDiffResult(
  context: vscode.ExtensionContext,
  left: FileDocument,
  right: FileDocument,
  result: DiffResult,
): void {
  latestMessage = {
    type: "diffResult",
    left: toFileInfo(left),
    right: toFileInfo(right),
    summary: result.summary,
    rows: result.rows,
  };

  if (currentPanel) {
    currentPanel.reveal(vscode.ViewColumn.Active);
    // The webview is already up, so post immediately.
    void currentPanel.webview.postMessage(latestMessage);
    return;
  }

  currentPanel = vscode.window.createWebviewPanel(
    "largeFileCompare.diff",
    "Large File Compare",
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      // Keep the (potentially large) rendered result alive when the tab is
      // hidden, so switching away and back doesn't re-post everything.
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")],
    },
  );

  currentPanel.webview.onDidReceiveMessage(
    (message: WebviewToHostMessage) => {
      // First-load handshake: send the pending result once the webview mounts.
      if (message?.type === "ready" && latestMessage) {
        void currentPanel?.webview.postMessage(latestMessage);
      }
    },
    undefined,
    context.subscriptions,
  );

  currentPanel.onDidDispose(
    () => {
      currentPanel = undefined;
    },
    undefined,
    context.subscriptions,
  );

  currentPanel.webview.html = buildHtml(currentPanel.webview, context.extensionUri);
}

function toFileInfo(doc: FileDocument) {
  return { name: basename(doc.path), lineCount: doc.lines.length, empty: doc.isEmpty };
}

/** Build the webview HTML: strict CSP, nonce'd script, bundled JS/CSS. */
function buildHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "webview.js"),
  );
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "webview.css"),
  );
  const nonce = makeNonce();

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';"
    />
    <link href="${styleUri}" rel="stylesheet" />
    <title>Large File Compare</title>
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
}

function makeNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}

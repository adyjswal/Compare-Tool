import { basename } from "node:path";
import * as vscode from "vscode";
import { diffLines, sortLines } from "@large-file-compare/engine";
import type { DiffResult, FileDocument, SortOptions } from "@large-file-compare/engine";
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

/** Bumped for each fresh comparison so the webview can reset its toolbar. */
let comparisonCounter = 0;

/**
 * The lines of the two files currently on screen. Kept so the webview's sort
 * toolbar can ask the host to re-compare without re-reading from disk.
 */
let currentSource: { left: string[]; right: string[] } | undefined;

/** Open (or reuse) the diff panel and show a comparison result in it. */
export function showDiffResult(
  context: vscode.ExtensionContext,
  left: FileDocument,
  right: FileDocument,
  result: DiffResult,
): void {
  currentSource = { left: left.lines, right: right.lines };
  latestMessage = {
    type: "diffResult",
    comparisonId: ++comparisonCounter,
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
      } else if (message?.type === "sort") {
        applySort(message.options);
      }
    },
    undefined,
    context.subscriptions,
  );

  currentPanel.onDidDispose(
    () => {
      currentPanel = undefined;
      currentSource = undefined;
    },
    undefined,
    context.subscriptions,
  );

  currentPanel.webview.html = buildHtml(currentPanel.webview, context.extensionUri);
}

/**
 * Re-run the current comparison under a new sort and push the result back.
 *
 * With options, both files are sorted and compared in "set" mode (positions no
 * longer meaningful, so modified lines stay as separate removed/added). With
 * `null`, we fall back to the original order and the default positional diff.
 */
function applySort(options: SortOptions | null): void {
  if (!currentSource || !latestMessage) {
    return;
  }

  const result: DiffResult = options
    ? diffLines(sortLines(currentSource.left, options), sortLines(currentSource.right, options), {
        mode: "set",
      })
    : diffLines(currentSource.left, currentSource.right);

  latestMessage = { ...latestMessage, summary: result.summary, rows: result.rows };
  void currentPanel?.webview.postMessage(latestMessage);
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

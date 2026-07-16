import { join } from "node:path";
import { Worker } from "node:worker_threads";
import * as vscode from "vscode";
import type {
  CompareMessage,
  DiffResultMessage,
  FileInfo,
  HostToWebviewMessage,
  WebviewToHostMessage,
} from "../protocol";
import type {
  CompareOptions,
  FileMeta,
  WorkerRequest,
  WorkerResponse,
} from "../worker/messages";

/**
 * Manages the single webview panel and the diff worker behind it.
 *
 * We keep one panel and reuse it across comparisons. A worker thread owns the
 * (potentially huge) file line arrays and does the heavy read/sort/diff off the
 * host thread, streaming back progress and a compact columnar result. The panel
 * relays those to the webview, holding the most recent message so it can be
 * re-sent once the webview reports it's `ready`.
 */

interface Session {
  worker: Worker;
  requestId: number;
  compare: CompareOptions;
  comparisonId: number;
  leftPath: string;
  rightPath: string;
  left?: FileMeta;
  right?: FileMeta;
}

let currentPanel: vscode.WebviewPanel | undefined;
let session: Session | undefined;
let pendingMessage: HostToWebviewMessage | undefined;
let comparisonCounter = 0;

/** Open (or reuse) the diff panel and start comparing two files. */
export function showComparison(
  context: vscode.ExtensionContext,
  leftPath: string,
  rightPath: string,
): void {
  ensurePanel(context);
  currentPanel?.reveal(vscode.ViewColumn.Active);

  // Fresh comparison: tear down any previous worker and start a new one.
  session?.worker.terminate();
  const worker = new Worker(join(context.extensionUri.fsPath, "dist", "diffWorker.js"));
  const compare: CompareOptions = { sort: null, key: null };
  session = {
    worker,
    requestId: 1,
    compare,
    comparisonId: ++comparisonCounter,
    leftPath,
    rightPath,
  };

  worker.on("message", (response: WorkerResponse) => onWorkerMessage(response));
  worker.on("error", (err) => send({ type: "error", message: toMessage(err) }));

  send({ type: "status", phase: "reading" });
  post(worker, { type: "load", id: session.requestId, leftPath, rightPath, compare });
}

/** Handle a message coming back from the worker for the active session. */
function onWorkerMessage(response: WorkerResponse): void {
  if (!session || response.id !== session.requestId) {
    return; // stale response from a superseded/terminated request
  }

  switch (response.type) {
    case "progress":
      send({ type: "status", phase: response.phase, lines: response.lines });
      return;
    case "meta":
      session.left = response.left;
      session.right = response.right;
      if (response.left.binary || response.right.binary) {
        const names = [response.left, response.right]
          .filter((m) => m.binary)
          .map((m) => m.path)
          .join(" and ");
        send({
          type: "error",
          message: `${names} looks binary, not text. Please pick text files.`,
        });
      }
      return;
    case "result": {
      if (!session.left || !session.right) {
        return;
      }
      const message: DiffResultMessage = {
        type: "diffResult",
        comparisonId: session.comparisonId,
        left: toFileInfo(session.left),
        right: toFileInfo(session.right),
        summary: response.result.summary,
        statuses: response.result.statuses,
        lefts: response.result.lefts,
        rights: response.result.rights,
      };
      send(message);
      return;
    }
    case "error":
      send({ type: "error", message: response.message });
      return;
  }
}

/** Create the panel and wire its lifecycle, unless one already exists. */
function ensurePanel(context: vscode.ExtensionContext): void {
  if (currentPanel) {
    return;
  }

  currentPanel = vscode.window.createWebviewPanel(
    "largeFileCompare.diff",
    "Large File Compare",
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")],
    },
  );

  currentPanel.webview.onDidReceiveMessage(
    (message: WebviewToHostMessage) => onWebviewMessage(message),
    undefined,
    context.subscriptions,
  );

  currentPanel.onDidDispose(
    () => {
      session?.worker.terminate();
      session = undefined;
      pendingMessage = undefined;
      currentPanel = undefined;
    },
    undefined,
    context.subscriptions,
  );

  currentPanel.webview.html = buildHtml(currentPanel.webview, context.extensionUri);
}

/** Handle a message from the webview. */
function onWebviewMessage(message: WebviewToHostMessage): void {
  if (!session) {
    return;
  }
  switch (message.type) {
    case "ready":
      if (pendingMessage) {
        void currentPanel?.webview.postMessage(pendingMessage);
      }
      return;
    case "compare":
      recompute(message);
      return;
    case "reload":
      reload();
      return;
    case "cancel":
      session.worker.terminate();
      send({ type: "error", message: "Comparison canceled." });
      session = undefined;
      return;
  }
}

/**
 * Re-read both files from disk and re-run the comparison, keeping the same
 * comparison id (so the webview preserves its sort/find/view state) and the
 * current sort/key options (so the refreshed result matches what's on screen).
 */
function reload(): void {
  if (!session) {
    return;
  }
  session.requestId += 1;
  send({ type: "status", phase: "reading" });
  post(session.worker, {
    type: "load",
    id: session.requestId,
    leftPath: session.leftPath,
    rightPath: session.rightPath,
    compare: session.compare,
  });
}

/** Re-run the current comparison under new sort / key options. */
function recompute(message: CompareMessage): void {
  if (!session) {
    return;
  }
  session.compare = message.options;
  session.requestId += 1;
  send({ type: "status", phase: "diffing" });
  post(session.worker, { type: "recompute", id: session.requestId, compare: message.options });
}

/** Post a request to the worker (moving the status buffer is worker→host only). */
function post(worker: Worker, request: WorkerRequest): void {
  worker.postMessage(request);
}

/** Send a message to the webview and remember it for the `ready` handshake. */
function send(message: HostToWebviewMessage): void {
  pendingMessage = message;
  void currentPanel?.webview.postMessage(message);
}

function toFileInfo(meta: FileMeta): FileInfo {
  return { name: meta.path, lineCount: meta.lineCount, empty: meta.empty };
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Build the webview HTML: strict CSP, nonce'd script, bundled JS/CSS. */
function buildHtml(webview: vscode.Webview, uri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(uri, "dist", "webview.js"));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(uri, "dist", "webview.css"));
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

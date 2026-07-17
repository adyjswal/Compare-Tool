import { basename } from "node:path";
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
  Side,
  WorkerRequest,
  WorkerResponse,
} from "../worker/messages";

/**
 * Manages the single webview panel and the diff worker behind it.
 *
 * A comparison side is a VS Code Uri (a file, or an open/untitled document).
 * The panel resolves each side to a worker `Side`: a saved, unmodified file is
 * streamed from disk (fast on huge files); an untitled or unsaved-edited
 * document uses its live text. Reload re-resolves both, so edits made in a tab
 * — saved or not — show up on the next reload.
 */

interface Session {
  worker: Worker;
  requestId: number;
  compare: CompareOptions;
  comparisonId: number;
  leftUri: vscode.Uri;
  rightUri: vscode.Uri;
  left?: FileMeta;
  right?: FileMeta;
}

let currentPanel: vscode.WebviewPanel | undefined;
let session: Session | undefined;
let pendingMessage: HostToWebviewMessage | undefined;
let comparisonCounter = 0;
let workerPath = "";

/** Open (or reuse) the diff panel and start comparing two documents. */
export function showComparison(
  context: vscode.ExtensionContext,
  leftUri: vscode.Uri,
  rightUri: vscode.Uri,
): void {
  workerPath = vscode.Uri.joinPath(context.extensionUri, "dist", "diffWorker.js").fsPath;
  ensurePanel(context);
  currentPanel?.reveal(vscode.ViewColumn.Active);

  // Fresh comparison: tear down any previous worker and start a new one.
  session?.worker.terminate();
  const worker = new Worker(workerPath);
  session = {
    worker,
    requestId: 1,
    compare: { sort: null, key: null, pairChanged: true, ignoreWhitespace: true },
    comparisonId: ++comparisonCounter,
    leftUri,
    rightUri,
  };

  worker.on("message", (response: WorkerResponse) => onWorkerMessage(response));
  worker.on("error", (err) => send({ type: "error", message: toMessage(err) }));

  void loadSession();
}

/** Resolve both sides (disk or live text) and send them to the worker. */
async function loadSession(): Promise<void> {
  const active = session;
  if (!active) {
    return;
  }
  // Snapshot the request id *before* awaiting. reload/swap/recompute mutate the
  // same session object in place, so an object-identity check alone wouldn't
  // catch them — comparing this scalar after the await does.
  const requestId = active.requestId;
  send({ type: "status", phase: "reading" });
  try {
    const [left, right] = await Promise.all([resolveSide(active.leftUri), resolveSide(active.rightUri)]);
    if (session !== active || active.requestId !== requestId) {
      return; // superseded by a new comparison, reload, swap, or recompute
    }
    post(active.worker, { type: "load", id: requestId, left, right, compare: active.compare });
  } catch (err) {
    if (session === active && active.requestId === requestId) {
      send({ type: "error", message: toMessage(err) });
    }
  }
}

/**
 * A saved file that isn't open-with-unsaved-edits is streamed from disk (cheap
 * for huge files); an untitled doc, or a file with unsaved edits, uses its live
 * in-editor text so pasted/edited content is compared as shown.
 */
async function resolveSide(uri: vscode.Uri): Promise<Side> {
  const name = uriName(uri);
  const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  if (uri.scheme === "file" && (!open || !open.isDirty)) {
    return { kind: "file", name, path: uri.fsPath };
  }
  const doc = open ?? (await vscode.workspace.openTextDocument(uri));
  return { kind: "content", name, text: doc.getText() };
}

function uriName(uri: vscode.Uri): string {
  if (uri.scheme === "untitled") {
    return basename(uri.path) || "Untitled";
  }
  return basename(uri.fsPath);
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
      session.requestId += 1;
      void loadSession();
      return;
    case "swap": {
      const { leftUri } = session;
      session.leftUri = session.rightUri;
      session.rightUri = leftUri;
      session.requestId += 1;
      void loadSession();
      return;
    }
    case "openSide":
      void vscode.window.showTextDocument(
        message.side === "left" ? session.leftUri : session.rightUri,
        { viewColumn: vscode.ViewColumn.Beside, preview: false },
      );
      return;
    case "cancel":
      session.worker.terminate();
      send({ type: "error", message: "Comparison canceled." });
      session = undefined;
      return;
  }
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

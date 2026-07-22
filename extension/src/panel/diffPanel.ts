import { createWriteStream } from "node:fs";
import { basename, dirname, join } from "node:path";
import { Worker } from "node:worker_threads";
import * as vscode from "vscode";
import type {
  CompareMessage,
  FileInfo,
  HostToWebviewMessage,
  InitSettingsMessage,
  PersistedSettings,
  SaveSettingsMessage,
  WebviewToHostMessage,
} from "../protocol";
import { STATUS_CODES } from "../worker/messages";
import type {
  ColumnarResult,
  CompareOptions,
  FileMeta,
  Side,
  WorkerRequest,
  WorkerResponse,
} from "../worker/messages";


/**
 * Manages the diff webview panels and the diff worker behind each one.
 *
 * Every comparison is independent: it opens its own panel with its own worker
 * and session, so you can keep several comparisons open side by side (and drag
 * any tab into a separate window). Sessions are tracked in a set and removed
 * when their panel is closed.
 *
 * A comparison side is a VS Code Uri (a file, or an open/untitled document).
 * Each side resolves to a worker `Side`: a saved, unmodified file is streamed
 * from disk (fast on huge files); an untitled or unsaved-edited document uses
 * its live text. Reload re-resolves both, so edits made in a tab — saved or not
 * — show up on the next reload.
 */

interface Session {
  panel: vscode.WebviewPanel;
  worker: Worker;
  requestId: number;
  compare: CompareOptions;
  comparisonId: number;
  leftUri: vscode.Uri;
  rightUri: vscode.Uri;
  left?: FileMeta;
  right?: FileMeta;
  /** The latest completed result, kept so it can be (re)streamed on `ready`. */
  result?: ColumnarResult;
  /** Last host→webview status/error, replayed when the webview (re)mounts. */
  pendingMessage?: HostToWebviewMessage;
}

/** Every live comparison. A session is removed when its panel is disposed. */
const sessions = new Set<Session>();
let comparisonCounter = 0;

/** Open a fresh diff panel and start comparing two documents in it. */
export function showComparison(
  context: vscode.ExtensionContext,
  leftUri: vscode.Uri,
  rightUri: vscode.Uri,
): void {
  const workerPath = vscode.Uri.joinPath(context.extensionUri, "dist", "diffWorker.js").fsPath;

  const panel = vscode.window.createWebviewPanel(
    "largeFileCompare.diff",
    compareTitle(leftUri, rightUri),
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")],
    },
  );

  const worker = new Worker(workerPath);
  const session: Session = {
    panel,
    worker,
    requestId: 1,
    compare: { sort: null, key: null, pairChanged: true, ignoreWhitespace: true },
    comparisonId: ++comparisonCounter,
    leftUri,
    rightUri,
  };
  sessions.add(session);

  worker.on("message", (response: WorkerResponse) => onWorkerMessage(session, response));
  worker.on("error", (err) => send(session, { type: "error", message: toMessage(err) }));

  panel.webview.onDidReceiveMessage(
    (message: WebviewToHostMessage) => onWebviewMessage(session, context, message),
    undefined,
    context.subscriptions,
  );

  panel.onDidDispose(
    () => {
      session.worker.terminate();
      sessions.delete(session);
    },
    undefined,
    context.subscriptions,
  );

  panel.webview.html = buildHtml(panel.webview, context.extensionUri);
  void loadSession(session);
}

/** A short tab title so multiple comparisons are easy to tell apart. */
function compareTitle(left: vscode.Uri, right: vscode.Uri): string {
  return `${uriName(left)} ↔ ${uriName(right)}`;
}

/** Resolve both sides (disk or live text) and send them to the worker. */
async function loadSession(session: Session): Promise<void> {
  // Snapshot the request id *before* awaiting. reload/swap/recompute bump it, so
  // comparing this scalar after the await catches a superseded load.
  const requestId = session.requestId;
  send(session, { type: "status", phase: "reading" });
  try {
    const [left, right] = await Promise.all([
      resolveSide(session.leftUri),
      resolveSide(session.rightUri),
    ]);
    if (!sessions.has(session) || session.requestId !== requestId) {
      return; // panel closed, or superseded by reload/swap/recompute
    }
    post(session.worker, { type: "load", id: requestId, left, right, compare: session.compare });
  } catch (err) {
    if (sessions.has(session) && session.requestId === requestId) {
      send(session, { type: "error", message: toMessage(err) });
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

/** Handle a message coming back from the worker for its session. */
function onWorkerMessage(session: Session, response: WorkerResponse): void {
  if (!sessions.has(session) || response.id !== session.requestId) {
    return; // stale response from a superseded/terminated request, or closed panel
  }

  switch (response.type) {
    case "progress":
      send(session, { type: "status", phase: response.phase, lines: response.lines });
      return;
    case "meta":
      session.left = response.left;
      session.right = response.right;
      if (response.left.binary || response.right.binary) {
        const names = [response.left, response.right]
          .filter((m) => m.binary)
          .map((m) => m.path)
          .join(" and ");
        send(session, {
          type: "error",
          message: `${names} looks binary, not text. Please pick text files.`,
        });
      }
      return;
    case "result": {
      if (!session.left || !session.right) {
        return;
      }
      session.result = response.result;
      sendReady(session);
      return;
    }
    case "error":
      send(session, { type: "error", message: response.message });
      return;
  }
}

/** Handle a message from a session's webview. */
function onWebviewMessage(
  session: Session,
  context: vscode.ExtensionContext,
  message: WebviewToHostMessage,
): void {
  if (!sessions.has(session)) {
    return; // canceled or closed
  }
  switch (message.type) {
    case "ready": {
      // Send persisted settings to the webview before delivering the result,
      // so toolbar state from the last session is restored on first render.
      const saved = context.globalState.get<PersistedSettings>('lfc.settings');
      if (saved) {
        void session.panel.webview.postMessage({ type: "init-settings", settings: saved } satisfies InitSettingsMessage);
      }
      // Re-deliver current state to a (re)mounted webview: the result metadata
      // if we have one (text is re-pulled on demand), else the last status.
      if (session.result) {
        sendReady(session);
      } else if (session.pendingMessage) {
        void session.panel.webview.postMessage(session.pendingMessage);
      }
      return;
    }
    case "getWindow":
      sendWindow(session, message.indices);
      return;
    case "find":
      sendFind(session, message.token, message.query, message.caseSensitive, message.isRegex);
      return;
    case "export":
      void exportDiff(session);
      return;
    case "compare":
      recompute(session, message);
      return;
    case "reload":
      session.requestId += 1;
      void loadSession(session);
      return;
    case "swap": {
      const { leftUri } = session;
      session.leftUri = session.rightUri;
      session.rightUri = leftUri;
      session.panel.title = compareTitle(session.leftUri, session.rightUri);
      session.requestId += 1;
      void loadSession(session);
      return;
    }
    case "openSide":
      void vscode.window.showTextDocument(
        message.side === "left" ? session.leftUri : session.rightUri,
        { viewColumn: vscode.ViewColumn.Beside, preview: false },
      );
      return;
    case "save-settings":
      void context.globalState.update('lfc.settings', (message as SaveSettingsMessage).settings);
      return;
    case "cancel":
      session.worker.terminate();
      send(session, { type: "error", message: "Comparison canceled." });
      // Drop the session so no more messages are served; the panel stays open
      // (showing the message) until the user closes it.
      sessions.delete(session);
      return;
  }
}

/**
 * Tell the webview a result is ready: metadata + the whole per-row status column
 * (small). The line text is NOT sent here — the webview pulls it per visible
 * window via `getWindow`, so the total data crossing the channel stays tiny no
 * matter how many rows. Posted directly (not via `send`) so it doesn't clobber
 * the pending status used for the `ready` handshake.
 */
function sendReady(session: Session): void {
  if (!session.result || !session.left || !session.right) {
    return;
  }
  void session.panel.webview.postMessage({
    type: "ready-result",
    comparisonId: session.comparisonId,
    left: toFileInfo(session.left),
    right: toFileInfo(session.right),
    summary: session.result.summary,
    statuses: session.result.statuses,
    leftMaxLen: session.result.leftMaxLen,
    rightMaxLen: session.result.rightMaxLen,
  });
}

/** Serve the line text for a set of requested row indices (a visible window). */
function sendWindow(session: Session, indices: number[]): void {
  if (!session.result) {
    return;
  }
  const { lefts, rights } = session.result;
  const outLefts = new Array<string>(indices.length);
  const outRights = new Array<string>(indices.length);
  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i];
    outLefts[i] = lefts[idx] ?? "";
    outRights[i] = rights[idx] ?? "";
  }
  void session.panel.webview.postMessage({
    type: "window",
    comparisonId: session.comparisonId,
    indices,
    lefts: outLefts,
    rights: outRights,
  });
}

/** Run a Find over all rows (host holds the text) and return matching indices. */
function sendFind(
  session: Session,
  token: number,
  query: string,
  caseSensitive: boolean,
  isRegex: boolean,
): void {
  if (!session.result) {
    return;
  }
  const { lefts, rights } = session.result;
  const matches: number[] = [];
  if (query !== "") {
    if (isRegex) {
      let re: RegExp;
      try {
        re = new RegExp(query, caseSensitive ? "" : "i");
      } catch {
        void session.panel.webview.postMessage({
          type: "find-result",
          comparisonId: session.comparisonId,
          token,
          indices: new Int32Array(0),
          regexError: true,
        });
        return;
      }
      for (let i = 0; i < lefts.length; i++) {
        if (re.test(lefts[i]) || re.test(rights[i])) {
          matches.push(i);
        }
      }
    } else {
      const needle = caseSensitive ? query : query.toLowerCase();
      for (let i = 0; i < lefts.length; i++) {
        const l = caseSensitive ? lefts[i] : lefts[i].toLowerCase();
        const r = caseSensitive ? rights[i] : rights[i].toLowerCase();
        if (l.includes(needle) || r.includes(needle)) {
          matches.push(i);
        }
      }
    }
  }
  void session.panel.webview.postMessage({
    type: "find-result",
    comparisonId: session.comparisonId,
    token,
    indices: Int32Array.from(matches),
  });
}

type ExportFormat = "csv" | "txt";
type ExportScope = "changes" | "all";

/**
 * Export the diff to a file. The host owns all the text, so it drives the whole
 * flow: pick a format (CSV / plain text) and scope (changed rows / all rows),
 * choose a destination, then stream the rows out (streamed so a 1M-row export
 * never builds one giant string).
 */
async function exportDiff(session: Session): Promise<void> {
  if (!session.result) {
    void vscode.window.showInformationMessage("Nothing to export yet — the comparison is still loading.");
    return;
  }

  const format = await vscode.window.showQuickPick(
    [
      { label: "CSV (.csv)", detail: "Spreadsheet columns: Status, line numbers, and both sides.", value: "csv" as ExportFormat },
      { label: "Plain text (.txt)", detail: "Readable git-style blocks per changed row.", value: "txt" as ExportFormat },
    ],
    { placeHolder: "Export format" },
  );
  if (!format) {
    return;
  }
  const scope = await vscode.window.showQuickPick(
    [
      { label: "Changed rows only", detail: "Added, removed, and changed rows.", value: "changes" as ExportScope },
      { label: "All rows", detail: "Every row, including unchanged.", value: "all" as ExportScope },
    ],
    { placeHolder: "Which rows to export?" },
  );
  if (!scope) {
    return;
  }

  const ext = format.value === "csv" ? "csv" : "txt";
  const base = `${uriName(session.leftUri)}-vs-${uriName(session.rightUri)}`.replace(/\.[^.]+$/, "");
  const dir =
    session.leftUri.scheme === "file"
      ? dirname(session.leftUri.fsPath)
      : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const defaultUri = dir ? vscode.Uri.file(join(dir, `${base}.${ext}`)) : undefined;
  const target = await vscode.window.showSaveDialog({
    defaultUri,
    filters: format.value === "csv" ? { "CSV files": ["csv"] } : { "Text files": ["txt"] },
  });
  if (!target) {
    return;
  }

  const result = session.result;
  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Exporting diff…" },
      () => writeDiffFile(target.fsPath, result, format.value, scope.value === "changes"),
    );
  } catch (err) {
    void vscode.window.showErrorMessage(`Large File Compare: export failed — ${toMessage(err)}`);
    return;
  }
  const open = await vscode.window.showInformationMessage(
    `Exported diff to ${basename(target.fsPath)}.`,
    "Open file",
  );
  if (open) {
    void vscode.window.showTextDocument(target);
  }
}

/** Stream the diff rows to `path` in the chosen format. */
function writeDiffFile(
  path: string,
  result: ColumnarResult,
  format: ExportFormat,
  changesOnly: boolean,
): Promise<void> {
  const { statuses, lefts, rights } = result;
  const stream = createWriteStream(path, { encoding: "utf8" });
  const done = new Promise<void>((resolve, reject) => {
    stream.on("error", reject);
    stream.on("finish", resolve);
  });
  // Await the drain when the OS buffer is full so a huge export stays bounded.
  const write = (chunk: string): Promise<void> =>
    new Promise((resolve) => {
      if (stream.write(chunk)) {
        resolve();
      } else {
        stream.once("drain", () => resolve());
      }
    });

  void (async () => {
    try {
      let buf = format === "csv" ? "Status,Left #,Right #,Left,Right\r\n" : "";
      let leftNo = 0;
      let rightNo = 0;
      let sinceFlush = 0;
      for (let i = 0; i < statuses.length; i++) {
        const s = statuses[i]; // 0 unchanged, 1 added, 2 removed, 3 changed
        // Line numbers count over EVERY row so they match the source files, even
        // when unchanged rows are filtered out of the output below.
        const ln = s === 0 || s === 2 || s === 3 ? ++leftNo : 0;
        const rn = s === 0 || s === 1 || s === 3 ? ++rightNo : 0;
        if (changesOnly && s === 0) {
          continue;
        }
        buf +=
          format === "csv"
            ? `${STATUS_CODES[s]},${ln || ""},${rn || ""},${csvField(lefts[i])},${csvField(rights[i])}\r\n`
            : textBlock(s, ln, rn, lefts[i], rights[i]);
        if (++sinceFlush >= 2000) {
          await write(buf);
          buf = "";
          sinceFlush = 0;
        }
      }
      if (buf) {
        await write(buf);
      }
      stream.end();
    } catch (err) {
      stream.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  return done;
}

/** RFC-4180 CSV field: quote when it contains a comma, quote, CR or LF. */
function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** One human-readable text block for a row (git-style +/- markers). */
function textBlock(status: number, leftNo: number, rightNo: number, left: string, right: string): string {
  const loc = `L${leftNo || "-"}  R${rightNo || "-"}`;
  switch (status) {
    case 1: // added
      return `ADDED      ${loc}\n  + ${right}\n`;
    case 2: // removed
      return `REMOVED    ${loc}\n  - ${left}\n`;
    case 3: // changed
      return `CHANGED    ${loc}\n  - ${left}\n  + ${right}\n`;
    default: // unchanged
      return `UNCHANGED  ${loc}\n    ${left}\n`;
  }
}

/** Re-run this session's comparison under new sort / key options. */
function recompute(session: Session, message: CompareMessage): void {
  session.compare = message.options;
  session.requestId += 1;
  send(session, { type: "status", phase: "diffing" });
  post(session.worker, { type: "recompute", id: session.requestId, compare: message.options });
}

function post(worker: Worker, request: WorkerRequest): void {
  worker.postMessage(request);
}

/** Send a message to a session's webview and remember it for the `ready` handshake. */
function send(session: Session, message: HostToWebviewMessage): void {
  session.pendingMessage = message;
  void session.panel.webview.postMessage(message);
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

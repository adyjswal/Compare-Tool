/**
 * Diff worker thread.
 *
 * Runs the heavy read + sort + diff off the extension host's main thread so
 * VS Code never freezes on a 1M-line comparison, and progress/cancel work.
 * The worker is stateful: it reads both files once (streamed) and keeps their
 * line arrays, so subsequent `recompute` requests (a new sort or key column)
 * don't re-read from disk.
 */
import { parentPort } from "node:worker_threads";
import {
  diffLines,
  isProbablyBinary,
  readFileDocumentStreamed,
  sortLines,
  splitLines,
} from "@large-file-compare/engine";
import type { DiffResult, FileDocument } from "@large-file-compare/engine";
import { STATUS_CODES } from "./messages";
import type {
  CompareOptions,
  ColumnarResult,
  FileMeta,
  Side,
  WorkerRequest,
  WorkerResponse,
} from "./messages";

const port = parentPort;
if (!port) {
  throw new Error("diffWorker must run as a worker thread");
}

// The files this worker is holding, kept for cheap re-diffs.
let left: FileDocument | undefined;
let right: FileDocument | undefined;

const post = (message: WorkerResponse) => {
  // The status column is a transferable ArrayBuffer — moved, not copied.
  const transfer =
    message.type === "result" ? [message.result.statuses.buffer as ArrayBuffer] : [];
  port.postMessage(message, transfer);
};

port.on("message", (request: WorkerRequest) => {
  void handle(request).catch((err) => {
    post({ type: "error", id: request.id, message: toMessage(err) });
  });
});

async function handle(request: WorkerRequest): Promise<void> {
  if (request.type === "load") {
    post({ type: "progress", id: request.id, phase: "reading" });
    left = await resolveSide(request.left, (lines) =>
      post({ type: "progress", id: request.id, phase: "reading", lines }),
    );
    right = await resolveSide(request.right, (lines) =>
      post({ type: "progress", id: request.id, phase: "reading", lines }),
    );
    post({ type: "meta", id: request.id, left: toMeta(left), right: toMeta(right) });

    // Don't diff binary content — the host shows an error instead.
    if (left.isBinary || right.isBinary) {
      return;
    }
  }

  if (!left || !right) {
    post({ type: "error", id: request.id, message: "no files loaded" });
    return;
  }

  post({ type: "progress", id: request.id, phase: "diffing" });
  const result = compute(left.lines, right.lines, request.compare);
  post({ type: "result", id: request.id, result: toColumnar(result) });
}

/** Turn a side into a FileDocument: stream a file from disk, or split live text. */
async function resolveSide(
  side: Side,
  onProgress: (lines: number) => void,
): Promise<FileDocument> {
  if (side.kind === "file") {
    const doc = await readFileDocumentStreamed(side.path, onProgress);
    return { ...doc, path: side.name };
  }
  // Live text (untitled / unsaved edits) still needs the binary check — e.g. a
  // binary file opened in the text editor and edited becomes a content side.
  if (isProbablyBinary(side.text)) {
    return { path: side.name, lines: [], isEmpty: side.text.length === 0, isBinary: true };
  }
  const lines = splitLines(side.text);
  return { path: side.name, lines, isEmpty: lines.length === 0, isBinary: false };
}

/** Run the requested comparison: key mode > sorted (set) mode > positional. */
function compute(
  leftLines: string[],
  rightLines: string[],
  compare: CompareOptions,
): DiffResult {
  const trim = compare.ignoreWhitespace;
  // Comparison is case-insensitive: lines differing only in letter case count as
  // unchanged (upper/lowercase treated as the same when matching).
  const caseInsensitive = true;
  if (compare.key) {
    return diffLines(leftLines, rightLines, { key: compare.key, trim, caseInsensitive });
  }
  if (compare.sort) {
    return diffLines(sortLines(leftLines, compare.sort), sortLines(rightLines, compare.sort), {
      mode: "set",
      trim,
      caseInsensitive,
    });
  }
  return diffLines(leftLines, rightLines, { pairChanged: compare.pairChanged, trim, caseInsensitive });
}

/** Pack the row objects into parallel columns for a cheap structured clone. */
function toColumnar(result: DiffResult): ColumnarResult {
  const n = result.rows.length;
  const statuses = new Uint8Array(n);
  const lefts = new Array<string>(n);
  const rights = new Array<string>(n);
  let leftMaxLen = 0;
  let rightMaxLen = 0;
  for (let i = 0; i < n; i++) {
    const row = result.rows[i];
    statuses[i] = STATUS_CODES.indexOf(row.status);
    const left = row.left ?? "";
    const right = row.right ?? "";
    lefts[i] = left;
    rights[i] = right;
    if (left.length > leftMaxLen) leftMaxLen = left.length;
    if (right.length > rightMaxLen) rightMaxLen = right.length;
  }
  return { statuses, lefts, rights, summary: result.summary, leftMaxLen, rightMaxLen };
}

function toMeta(doc: FileDocument): FileMeta {
  return {
    path: doc.path, // already the display name set in resolveSide
    lineCount: doc.lines.length,
    empty: doc.isEmpty,
    binary: doc.isBinary,
  };
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

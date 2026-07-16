/**
 * Diff worker thread.
 *
 * Runs the heavy read + sort + diff off the extension host's main thread so
 * VS Code never freezes on a 1M-line comparison, and progress/cancel work.
 * The worker is stateful: it reads both files once (streamed) and keeps their
 * line arrays, so subsequent `recompute` requests (a new sort or key column)
 * don't re-read from disk.
 */
import { basename } from "node:path";
import { parentPort } from "node:worker_threads";
import { diffLines, readFileDocumentStreamed, sortLines } from "@large-file-compare/engine";
import type { DiffResult, FileDocument } from "@large-file-compare/engine";
import { STATUS_CODES } from "./messages";
import type { CompareOptions, ColumnarResult, FileMeta, WorkerRequest, WorkerResponse } from "./messages";

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
    left = await readFileDocumentStreamed(request.leftPath, (lines) =>
      post({ type: "progress", id: request.id, phase: "reading", lines }),
    );
    right = await readFileDocumentStreamed(request.rightPath, (lines) =>
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

/** Run the requested comparison: key mode > sorted (set) mode > positional. */
function compute(
  leftLines: string[],
  rightLines: string[],
  compare: CompareOptions,
): DiffResult {
  if (compare.key) {
    return diffLines(leftLines, rightLines, { key: compare.key });
  }
  if (compare.sort) {
    return diffLines(sortLines(leftLines, compare.sort), sortLines(rightLines, compare.sort), {
      mode: "set",
    });
  }
  return diffLines(leftLines, rightLines);
}

/** Pack the row objects into parallel columns for a cheap structured clone. */
function toColumnar(result: DiffResult): ColumnarResult {
  const n = result.rows.length;
  const statuses = new Uint8Array(n);
  const lefts = new Array<string>(n);
  const rights = new Array<string>(n);
  for (let i = 0; i < n; i++) {
    const row = result.rows[i];
    statuses[i] = STATUS_CODES.indexOf(row.status);
    lefts[i] = row.left ?? "";
    rights[i] = row.right ?? "";
  }
  return { statuses, lefts, rights, summary: result.summary };
}

function toMeta(doc: FileDocument): FileMeta {
  return {
    path: basename(doc.path),
    lineCount: doc.lines.length,
    empty: doc.isEmpty,
    binary: doc.isBinary,
  };
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

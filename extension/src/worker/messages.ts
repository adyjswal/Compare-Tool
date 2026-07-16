/**
 * Message contract between the extension host and the diff worker thread.
 *
 * The worker owns the (potentially huge) file line arrays: it reads both files
 * once, then answers `recompute` requests — re-sorting / re-keying without
 * re-reading or shipping the lines back to the host. Results cross the wire in
 * a **compact columnar** form (three parallel arrays instead of a million small
 * objects) so structured-clone stays cheap at 1M rows.
 */
import type { ColumnSpec, DiffSummary, SortOptions } from "@large-file-compare/engine";

/** What to compute. `sort` null = original order; `key` null = whole-line. */
export interface CompareOptions {
  sort: SortOptions | null;
  key: ColumnSpec | null;
}

/** Lightweight per-file facts the header needs (plus the binary flag). */
export interface FileMeta {
  path: string;
  lineCount: number;
  empty: boolean;
  binary: boolean;
}

/**
 * The diff result as parallel columns. `statuses[i]` is a status code (see
 * `STATUS_CODES`); `lefts[i]`/`rights[i]` hold each side's text ("" where that
 * side is absent — which side is absent is implied by the status).
 */
export interface ColumnarResult {
  statuses: Uint8Array;
  lefts: string[];
  rights: string[];
  summary: DiffSummary;
}

/** Status ↔ code mapping, shared by worker (encode) and webview (decode). */
export const STATUS_CODES = ["unchanged", "added", "removed", "changed"] as const;

/* ---- host → worker ---- */
export type WorkerRequest =
  | { type: "load"; id: number; leftPath: string; rightPath: string; compare: CompareOptions }
  | { type: "recompute"; id: number; compare: CompareOptions };

/* ---- worker → host ---- */
export type WorkerResponse =
  | { type: "progress"; id: number; phase: "reading" | "diffing"; lines?: number }
  | { type: "meta"; id: number; left: FileMeta; right: FileMeta }
  | { type: "result"; id: number; result: ColumnarResult }
  | { type: "error"; id: number; message: string };

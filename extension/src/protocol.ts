/**
 * Messages passed between the extension host and the webview.
 *
 * Windowed transport: the host keeps the full result and pushes only the tiny
 * per-row status bytes (~1 byte/row) to the webview. The (large) line text is
 * pulled on demand, one visible window at a time, so the total data crossing
 * the webview channel never approaches its ~512MB serialization ceiling — this
 * is what lets the tool scale past ~1M rows. Find runs on the host (it holds
 * all the text) and returns matching row indices.
 */
import type { DiffSummary } from "@large-file-compare/engine";
import type { CompareOptions } from "./worker/messages";

/** Lightweight description of a compared file (just what the header needs). */
export interface FileInfo {
  name: string;
  lineCount: number;
  empty: boolean;
}

/** Host → webview: progress while the worker reads / diffs. */
export interface StatusMessage {
  type: "status";
  phase: "reading" | "diffing";
  /** Lines read so far (during the reading phase). */
  lines?: number;
}

/**
 * Host → webview: a comparison is ready. Carries metadata plus the full per-row
 * status column (small — ~1 byte/row). Text is fetched later via `getWindow`.
 */
export interface ReadyResultMessage {
  type: "ready-result";
  /**
   * Identifies the pair of files being compared. It stays constant across
   * re-sorts of the same comparison and changes when a fresh comparison opens,
   * so the webview knows when to reset its toolbar state.
   */
  comparisonId: number;
  left: FileInfo;
  right: FileInfo;
  summary: DiffSummary;
  /** Per-row status code (length = total rows); see STATUS_CODES. */
  statuses: Uint8Array;
  /** Longest line length (chars) per side — for sizing horizontal scroll. */
  leftMaxLen: number;
  rightMaxLen: number;
}

/** Host → webview: the line text for a set of requested row indices. */
export interface WindowMessage {
  type: "window";
  comparisonId: number;
  /** The row indices these texts correspond to (parallel to lefts/rights). */
  indices: number[];
  /** Text per index; "" where that side is absent (implied by the status). */
  lefts: string[];
  rights: string[];
}

/** Host → webview: rows (indices into the full result) that match a Find query. */
export interface FindResultMessage {
  type: "find-result";
  comparisonId: number;
  /** Echoes the request's token so stale responses can be ignored. */
  token: number;
  indices: Int32Array;
}

/** Host → webview: the comparison failed (unreadable / binary / etc.). */
export interface ErrorMessage {
  type: "error";
  message: string;
}

/** Webview → host: the React app has mounted and is ready to receive data. */
export interface ReadyMessage {
  type: "ready";
}

/** Webview → host: re-run the comparison with new sort / key options. */
export interface CompareMessage {
  type: "compare";
  options: CompareOptions;
}

/** Webview → host: abort the running comparison. */
export interface CancelMessage {
  type: "cancel";
}

/** Webview → host: re-read both sides (disk or live editor) and re-compare. */
export interface ReloadMessage {
  type: "reload";
}

/** Webview → host: swap which side is source (left) vs target (right). */
export interface SwapMessage {
  type: "swap";
}

/** Webview → host: open one side's document in an editor tab for editing. */
export interface OpenSideMessage {
  type: "openSide";
  side: "left" | "right";
}

/** Webview → host: fetch the line text for these row indices (a visible window). */
export interface GetWindowMessage {
  type: "getWindow";
  indices: number[];
}

/** Webview → host: find rows whose text matches (host has all the text). */
export interface FindMessage {
  type: "find";
  token: number;
  query: string;
  caseSensitive: boolean;
}

/**
 * Webview → host: export the diff. The host owns all the text, so it drives the
 * whole flow (QuickPick for format + scope, save dialog, streamed write).
 */
export interface ExportMessage {
  type: "export";
}

export type HostToWebviewMessage =
  | StatusMessage
  | ReadyResultMessage
  | WindowMessage
  | FindResultMessage
  | ErrorMessage;
export type WebviewToHostMessage =
  | ReadyMessage
  | CompareMessage
  | CancelMessage
  | ReloadMessage
  | SwapMessage
  | OpenSideMessage
  | GetWindowMessage
  | FindMessage
  | ExportMessage;

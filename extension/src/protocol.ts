/**
 * Messages passed between the extension host and the webview.
 *
 * Shared by both sides so the shape can't drift. The diff result crosses in a
 * compact columnar form (three parallel arrays, not a million row objects) so
 * structured-clone stays cheap at 1M rows; the webview rebuilds row objects.
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

/** Host → webview: a completed comparison, in columnar form. */
export interface DiffResultMessage {
  type: "diffResult";
  /**
   * Identifies the pair of files being compared. It stays constant across
   * re-sorts of the same comparison and changes when a fresh comparison opens,
   * so the webview knows when to reset its toolbar (sort/filter) state.
   */
  comparisonId: number;
  left: FileInfo;
  right: FileInfo;
  summary: DiffSummary;
  /** Per-row status code; see STATUS_CODES in worker/messages. */
  statuses: Uint8Array;
  /** Per-row text; "" where that side is absent (implied by the status). */
  lefts: string[];
  rights: string[];
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

/** Webview → host: re-read both files from disk and re-run the comparison. */
export interface ReloadMessage {
  type: "reload";
}

export type HostToWebviewMessage = StatusMessage | DiffResultMessage | ErrorMessage;
export type WebviewToHostMessage = ReadyMessage | CompareMessage | CancelMessage | ReloadMessage;

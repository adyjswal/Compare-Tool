/**
 * Messages passed between the extension host and the webview.
 *
 * Shared by both sides so the shape can't drift. The row/summary types come
 * straight from the engine, so there's a single source of truth.
 */
import type { DiffRow, DiffSummary, SortOptions } from "@large-file-compare/engine";

/** Lightweight description of a compared file (just what the header needs). */
export interface FileInfo {
  name: string;
  lineCount: number;
  empty: boolean;
}

/** Host → webview: here is a completed comparison to render. */
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
  rows: DiffRow[];
}

/** Webview → host: the React app has mounted and is ready to receive data. */
export interface ReadyMessage {
  type: "ready";
}

/**
 * Webview → host: re-run the comparison with a new sort.
 *
 * `options === null` restores the original file order (positional compare).
 * Otherwise both files are sorted with these options and compared in "set"
 * mode, where line positions no longer carry meaning. Sorting lives in the host
 * because that's where the engine (and the full file contents) already are.
 */
export interface SortRequestMessage {
  type: "sort";
  options: SortOptions | null;
}

export type HostToWebviewMessage = DiffResultMessage;
export type WebviewToHostMessage = ReadyMessage | SortRequestMessage;

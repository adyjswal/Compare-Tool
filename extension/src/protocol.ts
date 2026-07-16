/**
 * Messages passed between the extension host and the webview.
 *
 * Shared by both sides so the shape can't drift. The row/summary types come
 * straight from the engine, so there's a single source of truth.
 */
import type { DiffRow, DiffSummary } from "@large-file-compare/engine";

/** Lightweight description of a compared file (just what the header needs). */
export interface FileInfo {
  name: string;
  lineCount: number;
  empty: boolean;
}

/** Host → webview: here is a completed comparison to render. */
export interface DiffResultMessage {
  type: "diffResult";
  left: FileInfo;
  right: FileInfo;
  summary: DiffSummary;
  rows: DiffRow[];
}

/** Webview → host: the React app has mounted and is ready to receive data. */
export interface ReadyMessage {
  type: "ready";
}

export type HostToWebviewMessage = DiffResultMessage;
export type WebviewToHostMessage = ReadyMessage;

/**
 * Thin wrapper around the VS Code webview API.
 *
 * `acquireVsCodeApi()` is injected by VS Code and may only be called once, so
 * we cache the result.
 */
export interface VsCodeApi {
  postMessage(message: unknown): void;
  getState<T = unknown>(): T | undefined;
  setState<T>(state: T): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

let cached: VsCodeApi | undefined;

export function getVsCodeApi(): VsCodeApi {
  if (!cached) {
    cached = acquireVsCodeApi();
  }
  return cached;
}

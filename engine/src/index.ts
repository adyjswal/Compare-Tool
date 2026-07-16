/**
 * Large File Compare - engine
 * ---------------------------
 * Pure TypeScript core. This package MUST NOT import from `vscode` or any other
 * editor-specific API. All real logic (reading, sorting, diffing, filtering)
 * lives here so the same code can back plugins for other IDEs later
 * (IntelliJ, Eclipse, ...).
 *
 * This file is the public API barrel — the extension imports everything it
 * needs from here.
 */

export const ENGINE_VERSION = "0.0.1";

/** Small helper used by the extension to confirm the engine is reachable. */
export function engineInfo(): string {
  return `Large File Compare engine v${ENGINE_VERSION} (ready)`;
}

export * from "./types";
export * from "./reader";
export * from "./sorter";
export * from "./differ";
export * from "./filter";

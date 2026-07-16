/**
 * Large File Compare - engine
 * ---------------------------
 * Pure TypeScript core. This package MUST NOT import from `vscode` or any other
 * editor-specific API. All real logic (reading, sorting, diffing, filtering)
 * lives here so the same code can back plugins for other IDEs later
 * (IntelliJ, Eclipse, ...).
 *
 * Phase 0 is just scaffolding: this file only exposes a version marker and a
 * tiny helper the extension uses to prove the engine is wired in correctly.
 * The reader / sorter / differ / filter modules arrive in phase 1.
 */

export const ENGINE_VERSION = "0.0.1";

/** Placeholder used by the extension skeleton to confirm the engine is reachable. */
export function engineInfo(): string {
  return `Large File Compare engine v${ENGINE_VERSION} (ready)`;
}

import { basename } from "node:path";
import * as vscode from "vscode";
import { showComparison } from "../panel/diffPanel";

/**
 * Two ways to start a comparison from a right-click:
 *
 *  1. Multi-select: Ctrl/Cmd-click two files in the Explorer → "Diff Selected
 *     (Large File Compare)". One action; the first is the left/source.
 *  2. Two-step: "Select for Diff" (source / left), then "Diff with Selected"
 *     (target / right) — the only way that also works on editor tabs and
 *     untitled/pasted documents. It's one-shot: the armed selection is cleared
 *     once a comparison runs, so the menu item never lingers with a stale file.
 */

const CONTEXT_KEY = "largeFileCompare.hasSelectedForCompare";
let selected: vscode.Uri | undefined;

/** Clear the armed "source" selection (and hide the "Diff with Selected" item). */
function clearSelection(): void {
  selected = undefined;
  void vscode.commands.executeCommand("setContext", CONTEXT_KEY, false);
}

/**
 * Compare exactly two files selected together in the Explorer (first = left /
 * source). VS Code passes the whole multi-selection as the second argument for
 * Explorer context commands; we fall back to the single clicked resource.
 */
export function compareSelectedFiles(
  context: vscode.ExtensionContext,
  uri?: vscode.Uri,
  uris?: vscode.Uri[],
): void {
  const picked = (uris && uris.length > 0 ? uris : uri ? [uri] : []).filter(Boolean);
  if (picked.length < 2) {
    void vscode.window.showErrorMessage(
      "Large File Compare: select exactly two files (Ctrl/Cmd-click) to diff.",
    );
    return;
  }
  showComparison(context, picked[0], picked[1]);
}

/** Mark a document as the "source" side to compare against. */
export function selectForCompare(uri?: vscode.Uri): void {
  const target = resolveUri(uri);
  if (!target) {
    void vscode.window.showErrorMessage("Large File Compare: nothing to select — open or click a file first.");
    return;
  }
  selected = target;
  void vscode.commands.executeCommand("setContext", CONTEXT_KEY, true);
  void vscode.window.setStatusBarMessage(
    `Large File Compare: selected "${label(target)}" — now right-click the other side → Diff with Selected`,
    5000,
  );
}

/** Compare the previously selected source with this target (source on the left). */
export function compareWithSelected(context: vscode.ExtensionContext, uri?: vscode.Uri): void {
  const target = resolveUri(uri);
  if (!target) {
    void vscode.window.showErrorMessage("Large File Compare: nothing to compare — open or click a file first.");
    return;
  }
  if (!selected) {
    void vscode.window.showErrorMessage(
      'Large File Compare: run "Select for Diff" on the first side, then "Diff with Selected" on the second.',
    );
    return;
  }
  showComparison(context, selected, target);
  // One-shot: forget the armed source so the menu item doesn't linger with a
  // stale file after the comparison opens.
  clearSelection();
}

/** Use the clicked resource, or fall back to the active editor's document. */
function resolveUri(uri?: vscode.Uri): vscode.Uri | undefined {
  return uri ?? vscode.window.activeTextEditor?.document.uri;
}

function label(uri: vscode.Uri): string {
  return uri.scheme === "untitled" ? basename(uri.path) || "Untitled" : basename(uri.fsPath);
}

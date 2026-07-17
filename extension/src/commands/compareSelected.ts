import { basename } from "node:path";
import * as vscode from "vscode";
import { showComparison } from "../panel/diffPanel";

/**
 * VS Code-native two-step compare: right-click something → "Select for Compare"
 * (the source / left), then right-click another → "Compare with Selected" (the
 * target / right). Works on Explorer files, editor tabs, and untitled/pasted
 * documents — anything with a Uri — so you can compare scratch text too.
 */

const CONTEXT_KEY = "largeFileCompare.hasSelectedForCompare";
let selected: vscode.Uri | undefined;

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
    `Large File Compare: selected "${label(target)}" — now right-click the other side → Compare with Selected`,
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
      'Large File Compare: run "Select for Compare" on the first side, then "Compare with Selected" on the second.',
    );
    return;
  }
  showComparison(context, selected, target);
}

/** Use the clicked resource, or fall back to the active editor's document. */
function resolveUri(uri?: vscode.Uri): vscode.Uri | undefined {
  return uri ?? vscode.window.activeTextEditor?.document.uri;
}

function label(uri: vscode.Uri): string {
  return uri.scheme === "untitled" ? basename(uri.path) || "Untitled" : basename(uri.fsPath);
}

import * as vscode from "vscode";
import { compareFilesCommand } from "./commands/compareFiles";

/**
 * Extension entry point.
 *
 * VS Code calls activate() the first time one of our contributed commands runs.
 * (The activation event for `largeFileCompare.compareFiles` is implicit because
 * the command is declared in package.json > contributes.commands.)
 */
export function activate(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand(
    "largeFileCompare.compareFiles",
    async () => {
      try {
        await compareFilesCommand();
      } catch (err) {
        // Backstop so nothing fails silently; friendlier per-case messages are
        // shown inside the command itself, and richer handling comes in phase 5.
        const message = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`Large File Compare: ${message}`);
      }
    },
  );

  context.subscriptions.push(disposable);
}

export function deactivate(): void {
  // Nothing to clean up yet.
}

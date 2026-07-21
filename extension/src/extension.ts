import * as vscode from "vscode";
import { compareFilesCommand } from "./commands/compareFiles";
import {
  compareSelectedFiles,
  compareWithSelected,
  selectForCompare,
} from "./commands/compareSelected";

/**
 * Extension entry point.
 *
 * VS Code calls activate() the first time one of our contributed commands runs.
 * (Activation events for the commands are implicit because they're declared in
 * package.json > contributes.commands.)
 */
export function activate(context: vscode.ExtensionContext): void {
  // The "Compare with Selected" menu is gated on this key. Nothing is selected
  // on a fresh host, so start it false (the selection state doesn't survive a
  // host restart, but the renderer's context key would otherwise linger).
  void vscode.commands.executeCommand("setContext", "largeFileCompare.hasSelectedForCompare", false);

  const guard = (fn: () => void | Promise<void>) => async () => {
    try {
      await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`Large File Compare: ${message}`);
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "largeFileCompare.compareFiles",
      guard(() => compareFilesCommand(context)),
    ),
    vscode.commands.registerCommand(
      "largeFileCompare.compareSelectedFiles",
      (uri?: vscode.Uri, uris?: vscode.Uri[]) =>
        guard(() => compareSelectedFiles(context, uri, uris))(),
    ),
    vscode.commands.registerCommand("largeFileCompare.selectForCompare", (uri?: vscode.Uri) =>
      guard(() => selectForCompare(uri))(),
    ),
    vscode.commands.registerCommand("largeFileCompare.compareWithSelected", (uri?: vscode.Uri) =>
      guard(() => compareWithSelected(context, uri))(),
    ),
  );
}

export function deactivate(): void {
  // Nothing to clean up yet.
}

import * as vscode from "vscode";
import { engineInfo } from "@large-file-compare/engine";

/**
 * Extension entry point.
 *
 * VS Code calls activate() the first time one of our contributed commands runs.
 * (The activation event for `largeFileCompare.compareFiles` is implicit because
 * the command is declared in package.json > contributes.commands, so we don't
 * need to list it in activationEvents.)
 */
export function activate(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand(
    "largeFileCompare.compareFiles",
    () => {
      // Phase 0 skeleton: prove the command runs AND that the pure-TS engine is
      // reachable from the extension host. The real flow (file pickers -> engine
      // sort/diff -> virtualized webview) is built in the later phases.
      vscode.window.showInformationMessage(
        `Large File Compare is alive. ${engineInfo()}`
      );
    }
  );

  context.subscriptions.push(disposable);
}

export function deactivate(): void {
  // Nothing to clean up yet.
}

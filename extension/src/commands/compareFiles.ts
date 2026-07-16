import { basename } from "node:path";
import * as vscode from "vscode";
import { diffLines, readFileDocument } from "@large-file-compare/engine";
import type { FileDocument } from "@large-file-compare/engine";
import { showDiffResult } from "../panel/diffPanel";

/**
 * The "Compare Two Files" command.
 *
 * Flow: pick two files → read both via the engine → diff them *as-is* (no
 * sorting, default positional mode) → render the result in the webview panel.
 *
 * Only the obvious failure cases are handled here (cancel, unreadable, binary).
 * Richer error/loading handling is phase 5.
 */
export async function compareFilesCommand(context: vscode.ExtensionContext): Promise<void> {
  const leftUri = await pickFile("Select the FIRST file (left)");
  if (!leftUri) {
    return; // user cancelled
  }

  const rightUri = await pickFile("Select the SECOND file (right)");
  if (!rightUri) {
    return; // user cancelled
  }

  let left: FileDocument;
  let right: FileDocument;
  try {
    [left, right] = await Promise.all([
      readFileDocument(leftUri.fsPath),
      readFileDocument(rightUri.fsPath),
    ]);
  } catch (err) {
    void vscode.window.showErrorMessage(
      `Large File Compare: couldn't read a file — ${toMessage(err)}`,
    );
    return;
  }

  const binary = [left, right].filter((doc) => doc.isBinary);
  if (binary.length > 0) {
    const names = binary.map((doc) => basename(doc.path)).join(" and ");
    void vscode.window.showErrorMessage(
      `Large File Compare: ${names} looks binary, not text. Please pick text files.`,
    );
    return;
  }

  // Compare as-is: no sorting, default positional mode (modified lines pair
  // into "changed"). Sorting will become an opt-in step in a later phase.
  const result = diffLines(left.lines, right.lines);

  showDiffResult(context, left, right, result);
}

/** Show a single-file open dialog, returning the chosen Uri (or undefined). */
async function pickFile(prompt: string): Promise<vscode.Uri | undefined> {
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    canSelectFolders: false,
    openLabel: prompt,
    title: prompt,
    filters: {
      "Text files": [
        "txt",
        "sql",
        "csv",
        "tsv",
        "log",
        "properties",
        "conf",
        "config",
        "ini",
        "json",
        "xml",
        "yaml",
        "yml",
        "md",
      ],
      "All files": ["*"],
    },
  });
  return picked?.[0];
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

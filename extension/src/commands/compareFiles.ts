import * as vscode from "vscode";
import { showComparison } from "../panel/diffPanel";

/**
 * The "Compare Two Files" command.
 *
 * Flow: pick two files → hand their paths to the panel, which drives a worker
 * thread that reads + diffs them off the main thread (streaming, with progress
 * and cancel). Reading, binary detection and diffing all happen in the worker,
 * so this command stays tiny and the UI never blocks — even at ~1M lines.
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

  showComparison(context, leftUri, rightUri);
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

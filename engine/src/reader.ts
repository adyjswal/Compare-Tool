/**
 * Reading files into lines.
 *
 * The heavy lifting is pure string work (`splitLines`, `isProbablyBinary`) so it
 * is trivial to unit-test without touching the disk. `readFileDocument` is the
 * one function that does I/O, via Node's fs — no `vscode`, no other IDE APIs.
 */
import { readFile } from "node:fs/promises";

export interface FileDocument {
  /** The path this document was read from. */
  path: string;
  /** File contents split into lines (a single trailing newline is dropped). */
  lines: string[];
  /** True when there are no usable lines. */
  isEmpty: boolean;
  /** True when the content looks binary (heuristic — see `isProbablyBinary`). */
  isBinary: boolean;
}

/** Only sniff the first chunk of a file; that's enough to spot binary content. */
const BINARY_SNIFF_BYTES = 8000;

/**
 * Heuristic binary check: a NUL byte in the first several KB is a strong signal
 * the file is not text (this is essentially what Git uses). Not foolproof, but
 * good enough to keep users from trying to "compare" an image or executable.
 */
export function isProbablyBinary(sample: Buffer | string): boolean {
  const limit = Math.min(sample.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < limit; i++) {
    const byte = typeof sample === "string" ? sample.charCodeAt(i) : sample[i];
    if (byte === 0) {
      return true;
    }
  }
  return false;
}

/**
 * Split raw text into lines. Tolerant of Windows (CRLF), old-Mac (CR) and Unix
 * (LF) endings, strips a leading UTF-8 BOM, and does not emit a phantom empty
 * line for a file that simply ends in a newline.
 */
export function splitLines(content: string): string[] {
  // Drop a leading byte-order mark if present.
  const normalized = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  if (normalized.length === 0) {
    return [];
  }
  const lines = normalized.split(/\r\n|\r|\n/);
  // A trailing newline produces one empty element at the end — drop it.
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

/**
 * Read a UTF-8 text file from disk into a `FileDocument`.
 *
 * If the content looks binary we return early with `isBinary: true` and no
 * lines, so callers can show a friendly error instead of rendering garbage.
 */
export async function readFileDocument(path: string): Promise<FileDocument> {
  const buffer = await readFile(path);
  if (isProbablyBinary(buffer)) {
    return { path, lines: [], isEmpty: buffer.length === 0, isBinary: true };
  }
  const lines = splitLines(buffer.toString("utf8"));
  return { path, lines, isEmpty: lines.length === 0, isBinary: false };
}

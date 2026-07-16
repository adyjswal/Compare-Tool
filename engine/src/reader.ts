/**
 * Reading files into lines.
 *
 * The heavy lifting is pure string work (`splitLines`, `isProbablyBinary`) so it
 * is trivial to unit-test without touching the disk. `readFileDocument` is the
 * one function that does I/O, via Node's fs — no `vscode`, no other IDE APIs.
 */
import { createReadStream } from "node:fs";
import { open, readFile } from "node:fs/promises";
import { createInterface } from "node:readline";

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

/**
 * Streaming variant of {@link readFileDocument} for very large files.
 *
 * Instead of holding the whole file as a Buffer *and* a decoded string *and* a
 * line array all at once, this sniffs the first chunk for binary content, then
 * streams the file line-by-line so only the resulting `lines` array is kept in
 * memory. That roughly halves peak memory on 200k–1M line inputs.
 *
 * Note: `readline` recognizes LF and CRLF endings (not lone-CR "classic Mac"
 * files); those are vanishingly rare for the SQL/CSV/code files this targets.
 * An optional `onLine` callback fires every `progressEvery` lines so a host can
 * report progress.
 */
export async function readFileDocumentStreamed(
  path: string,
  onProgress?: (linesSoFar: number) => void,
  progressEvery = 50_000,
): Promise<FileDocument> {
  const handle = await open(path, "r");
  try {
    const sniff = Buffer.alloc(BINARY_SNIFF_BYTES);
    const { bytesRead } = await handle.read(sniff, 0, BINARY_SNIFF_BYTES, 0);
    if (isProbablyBinary(sniff.subarray(0, bytesRead))) {
      return { path, lines: [], isEmpty: bytesRead === 0, isBinary: true };
    }
  } finally {
    await handle.close();
  }

  const lines: string[] = [];
  const rl = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  let first = true;
  for await (let line of rl) {
    if (first) {
      // Drop a leading UTF-8 BOM from the very first line.
      if (line.charCodeAt(0) === 0xfeff) {
        line = line.slice(1);
      }
      first = false;
    }
    lines.push(line);
    if (onProgress && lines.length % progressEvery === 0) {
      onProgress(lines.length);
    }
  }

  return { path, lines, isEmpty: lines.length === 0, isBinary: false };
}

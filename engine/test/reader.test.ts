import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  isProbablyBinary,
  readFileDocument,
  readFileDocumentStreamed,
  splitLines,
} from "../src/reader";

// Build these control characters at runtime so the source file stays pure ASCII
// (no literal BOM / NUL bytes lurking invisibly in the test).
const BOM = String.fromCharCode(0xfeff);
const NUL = String.fromCharCode(0);

describe("splitLines", () => {
  it("handles LF, CRLF and CR line endings", () => {
    expect(splitLines("a\r\nb\nc\rd")).toEqual(["a", "b", "c", "d"]);
  });

  it("drops a single trailing newline but keeps interior blank lines", () => {
    expect(splitLines("a\n")).toEqual(["a"]);
    expect(splitLines("a\n\n")).toEqual(["a", ""]);
  });

  it("returns [] for empty content and strips a leading BOM", () => {
    expect(splitLines("")).toEqual([]);
    expect(splitLines(BOM + "a\nb")).toEqual(["a", "b"]);
  });
});

describe("isProbablyBinary", () => {
  it("is false for plain text and true when a NUL byte is present", () => {
    expect(isProbablyBinary("hello\nworld")).toBe(false);
    expect(isProbablyBinary("he" + NUL + "llo")).toBe(true);
  });
});

describe("readFileDocument", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "lfc-reader-"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads a UTF-8 file into lines", async () => {
    const file = join(dir, "sample.txt");
    await writeFile(file, "x\ny\n", "utf8");
    const doc = await readFileDocument(file);
    expect(doc.lines).toEqual(["x", "y"]);
    expect(doc.isEmpty).toBe(false);
    expect(doc.isBinary).toBe(false);
  });

  it("flags an empty file", async () => {
    const file = join(dir, "empty.txt");
    await writeFile(file, "", "utf8");
    const doc = await readFileDocument(file);
    expect(doc.isEmpty).toBe(true);
    expect(doc.lines).toEqual([]);
  });

  it("flags a binary file (contains NUL bytes)", async () => {
    const file = join(dir, "blob.bin");
    await writeFile(file, Buffer.from([0x00, 0x01, 0x02, 0x00]));
    const doc = await readFileDocument(file);
    expect(doc.isBinary).toBe(true);
    expect(doc.lines).toEqual([]);
  });
});

describe("readFileDocumentStreamed", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "lfc-reader-stream-"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads UTF-8 lines (LF and CRLF) and strips a leading BOM", async () => {
    const file = join(dir, "sample.txt");
    await writeFile(file, BOM + "x\r\ny\nz\n", "utf8");
    const doc = await readFileDocumentStreamed(file);
    expect(doc.lines).toEqual(["x", "y", "z"]);
    expect(doc.isEmpty).toBe(false);
    expect(doc.isBinary).toBe(false);
  });

  it("flags an empty file", async () => {
    const file = join(dir, "empty.txt");
    await writeFile(file, "", "utf8");
    const doc = await readFileDocumentStreamed(file);
    expect(doc.isEmpty).toBe(true);
    expect(doc.lines).toEqual([]);
  });

  it("flags a binary file (contains NUL bytes)", async () => {
    const file = join(dir, "blob.bin");
    await writeFile(file, Buffer.from([0x00, 0x01, 0x02, 0x00]));
    const doc = await readFileDocumentStreamed(file);
    expect(doc.isBinary).toBe(true);
    expect(doc.lines).toEqual([]);
  });

  it("splits classic-Mac (lone CR) line endings", async () => {
    const file = join(dir, "cr.txt");
    await writeFile(file, "a\rb\rc", "utf8");
    const doc = await readFileDocumentStreamed(file);
    expect(doc.lines).toEqual(["a", "b", "c"]);
  });

  it("drops the trailing terminator on a CR-ended file but keeps interior blanks", async () => {
    const trailing = join(dir, "cr-trailing.txt");
    await writeFile(trailing, "a\rb\r", "utf8");
    expect((await readFileDocumentStreamed(trailing)).lines).toEqual(["a", "b"]);

    const blank = join(dir, "cr-blank.txt");
    await writeFile(blank, "a\r\rb", "utf8");
    expect((await readFileDocumentStreamed(blank)).lines).toEqual(["a", "", "b"]);
  });

  it("handles mixed CRLF + lone CR in one file", async () => {
    const file = join(dir, "mixed.txt");
    await writeFile(file, "a\r\nb\rc\nd", "utf8");
    const doc = await readFileDocumentStreamed(file);
    expect(doc.lines).toEqual(["a", "b", "c", "d"]);
  });

  it("reports progress for large inputs", async () => {
    const file = join(dir, "big.txt");
    const total = 250_000;
    await writeFile(file, Array.from({ length: total }, (_, i) => `line ${i}`).join("\n"), "utf8");

    let lastReported = 0;
    const doc = await readFileDocumentStreamed(file, (n) => (lastReported = n), 50_000);
    expect(doc.lines.length).toBe(total);
    expect(lastReported).toBeGreaterThanOrEqual(200_000);
  });
});

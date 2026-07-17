/**
 * Comparing two line lists.
 *
 * Three behaviors, chosen by the caller (the extension decides whether it
 * sorted the input, and passes options accordingly):
 *
 *  - Whole-line, "positional" (default): compare files in their existing order.
 *    Uses the `diff` package's `diffArrays` (an LCS/Myers diff); a removed line
 *    paired with the added line that replaced it becomes a `changed` row — the
 *    familiar side-by-side diff. Use when line order is meaningful.
 *
 *  - Whole-line, "set": same `diffArrays` comparison but with no pairing, so a
 *    modified line stays as a separate `removed` + `added`. Use after sorting,
 *    where line positions are no longer meaningful.
 *
 *  - Key column: record reconciliation. Rows are matched by a delimited key
 *    column; a matching key with different content is a `changed` row. This is
 *    the "sort + eyeball in Excel" replacement.
 *
 * In every mode, duplicates are preserved and `trim` / `caseInsensitive`
 * control how equality is judged.
 */
import { diffArrays } from "diff";
import { extractColumn } from "./sorter";
import {
  ColumnSpec,
  DiffMode,
  DiffOptions,
  DiffResult,
  DiffRow,
  DiffStatus,
  DiffSummary,
} from "./types";

/** Compare two line lists and return categorized rows plus a summary. */
export function diffLines(
  left: readonly string[],
  right: readonly string[],
  options: DiffOptions = {},
): DiffResult {
  const trim = options.trim ?? true;
  const caseInsensitive = options.caseInsensitive ?? false;
  const normalize = makeNormalizer(trim, caseInsensitive);

  const rows = options.key
    ? diffByKey(left, right, options.key, normalize)
    : diffWholeLine(left, right, options.mode ?? "positional", normalize, options.pairChanged ?? true);

  return { rows, summary: summarize(rows) };
}

/* ------------------------------------------------------------------ *
 * Whole-line comparison (patience diff over interned lines)
 * ------------------------------------------------------------------ */

/**
 * A run of the diff: `op` is EQUAL/DELETE/INSERT, `n` is how many lines.
 * EQUAL consumes n lines from both sides; DELETE from the left; INSERT the right.
 */
const EQUAL = 0;
const DELETE = 1;
const INSERT = 2;
interface Op {
  op: 0 | 1 | 2;
  n: number;
}

/** A unit of work for the iterative patience diff: a resolved run, or a range. */
type DiffOp = { kind: "op"; op: 0 | 1 | 2; n: number };
type DiffRange = { kind: "range"; al: number; ah: number; bl: number; bh: number; depth: number };
type WorkItem = DiffOp | DiffRange;

/**
 * Below this combined size, a segment with no unique anchors is diffed with the
 * `diff` package (Myers) for a clean minimal result. Above it, we don't risk the
 * O(N·D) blow-up — the whole segment is emitted as removed + added ("replaced").
 */
const BASE_MYERS_LIMIT = 2000;
/** Guard against pathological anchor nesting; deeper segments use the base path. */
const MAX_DEPTH = 4000;

/**
 * Whole-line diff tuned to stay fast on very large (200k–1M line) files.
 *
 * The `diff` package's Myers diff is O(N·D) and hangs when two big files differ
 * a lot. Instead we use a **patience diff**:
 *
 *  1. **Intern** each line to an integer id (normalizing trim/case once), so we
 *     compare cheap ints, not strings.
 *  2. **Anchor** on lines that appear exactly once on *both* sides and take the
 *     longest increasing run of them — those must line up. Recurse into the gaps
 *     between anchors (trimming common prefix/suffix first). Only tiny leftover
 *     segments fall back to Myers; huge anchorless blocks are a plain
 *     removed+added "replace".
 *
 * The recursion is driven by an explicit stack, so a 1M-line file can't blow the
 * call stack. Rows are rebuilt from the *original* lines by position.
 */
function diffWholeLine(
  left: readonly string[],
  right: readonly string[],
  mode: DiffMode,
  normalize: (s: string) => string,
  pairChanged: boolean,
): DiffRow[] {
  const dict = new Map<string, number>();
  let nextId = 0;
  const idOf = (line: string): number => {
    const key = normalize(line);
    let id = dict.get(key);
    if (id === undefined) {
      id = nextId++;
      dict.set(key, id);
    }
    return id;
  };
  const a = left.map(idOf);
  const b = right.map(idOf);

  const ops = diffIds(a, b);
  return mode === "positional"
    ? reconstructPositional(ops, left, right, pairChanged)
    : reconstructSet(ops, left, right);
}

/** Append a run to `ops`, coalescing with the previous run of the same kind. */
function pushOp(ops: Op[], op: 0 | 1 | 2, n: number): void {
  if (n <= 0) {
    return;
  }
  const last = ops[ops.length - 1];
  if (last && last.op === op) {
    last.n += n;
  } else {
    ops.push({ op, n });
  }
}

/** Patience-diff two id arrays into an ordered list of EQUAL/DELETE/INSERT runs. */
function diffIds(a: number[], b: number[]): Op[] {
  const ops: Op[] = [];
  // A stack of pending work; each item is either an already-resolved run to
  // append, or a [lo,hi) × [lo,hi) range still to diff. Ranges are expanded and
  // their parts pushed back in reverse, so items pop in left-to-right order.
  const stack: WorkItem[] = [{ kind: "range", al: 0, ah: a.length, bl: 0, bh: b.length, depth: 0 }];

  while (stack.length > 0) {
    const item = stack.pop() as WorkItem;
    if (item.kind === "op") {
      pushOp(ops, item.op, item.n);
      continue;
    }

    let { al, ah, bl, bh } = item;
    const parts: WorkItem[] = [];

    let prefix = 0;
    while (al < ah && bl < bh && a[al] === b[bl]) {
      al++;
      bl++;
      prefix++;
    }
    if (prefix > 0) {
      parts.push({ kind: "op", op: EQUAL, n: prefix });
    }

    let suffix = 0;
    while (ah > al && bh > bl && a[ah - 1] === b[bh - 1]) {
      ah--;
      bh--;
      suffix++;
    }

    if (al === ah) {
      if (bl < bh) parts.push({ kind: "op", op: INSERT, n: bh - bl });
    } else if (bl === bh) {
      parts.push({ kind: "op", op: DELETE, n: ah - al });
    } else {
      const anchors = item.depth <= MAX_DEPTH ? patienceAnchors(a, b, al, ah, bl, bh) : [];
      if (anchors.length === 0) {
        baseDiff(a, b, al, ah, bl, bh, parts);
      } else {
        let pa = al;
        let pb = bl;
        for (const [ai, bi] of anchors) {
          parts.push({ kind: "range", al: pa, ah: ai, bl: pb, bh: bi, depth: item.depth + 1 });
          parts.push({ kind: "op", op: EQUAL, n: 1 });
          pa = ai + 1;
          pb = bi + 1;
        }
        parts.push({ kind: "range", al: pa, ah, bl: pb, bh, depth: item.depth + 1 });
      }
    }

    if (suffix > 0) {
      parts.push({ kind: "op", op: EQUAL, n: suffix });
    }

    for (let i = parts.length - 1; i >= 0; i--) {
      stack.push(parts[i]);
    }
  }

  return ops;
}

/**
 * Diff a small (or anchorless) segment. Tiny segments go through the `diff`
 * package for a clean result; oversized anchorless blocks are emitted as a plain
 * removed + added replacement so we never risk the Myers blow-up.
 */
function baseDiff(
  a: number[],
  b: number[],
  al: number,
  ah: number,
  bl: number,
  bh: number,
  parts: WorkItem[],
): void {
  const leftLen = ah - al;
  const rightLen = bh - bl;
  if (leftLen + rightLen > BASE_MYERS_LIMIT) {
    if (leftLen > 0) parts.push({ kind: "op", op: DELETE, n: leftLen });
    if (rightLen > 0) parts.push({ kind: "op", op: INSERT, n: rightLen });
    return;
  }
  for (const change of diffArrays(a.slice(al, ah), b.slice(bl, bh))) {
    const n = change.value.length;
    if (change.added) parts.push({ kind: "op", op: INSERT, n });
    else if (change.removed) parts.push({ kind: "op", op: DELETE, n });
    else parts.push({ kind: "op", op: EQUAL, n });
  }
}

/**
 * Find "anchor" pairs: lines occurring exactly once on both sides, kept as the
 * longest run whose positions increase on both sides (a patience LIS). These are
 * points the two files must agree on.
 */
function patienceAnchors(
  a: number[],
  b: number[],
  al: number,
  ah: number,
  bl: number,
  bh: number,
): Array<[number, number]> {
  const leftPos = uniquePositions(a, al, ah);
  const rightPos = uniquePositions(b, bl, bh);

  const pairs: Array<[number, number]> = [];
  for (const [id, lp] of leftPos) {
    const rp = rightPos.get(id);
    if (rp !== undefined && rp >= 0 && lp >= 0) {
      pairs.push([lp, rp]);
    }
  }
  if (pairs.length === 0) {
    return [];
  }
  pairs.sort((x, y) => x[0] - y[0]);
  return longestIncreasingByRight(pairs);
}

/** Map id → its single position in [lo,hi), or -1 if it occurs more than once. */
function uniquePositions(ids: number[], lo: number, hi: number): Map<number, number> {
  const seen = new Map<number, number>();
  for (let i = lo; i < hi; i++) {
    const id = ids[i];
    seen.set(id, seen.has(id) ? -1 : i);
  }
  return seen;
}

/** Longest subsequence of pairs (pre-sorted by left) whose right pos increases. */
function longestIncreasingByRight(pairs: Array<[number, number]>): Array<[number, number]> {
  const n = pairs.length;
  const prev = new Array<number>(n).fill(-1);
  const tails: number[] = []; // tails[k] = index of the smallest tail of an LIS of length k+1

  for (let i = 0; i < n; i++) {
    const value = pairs[i][1];
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[tails[mid]][1] < value) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    if (lo === tails.length) tails.push(i);
    else tails[lo] = i;
  }

  const result: Array<[number, number]> = [];
  let k = tails.length > 0 ? tails[tails.length - 1] : -1;
  while (k !== -1) {
    result.push(pairs[k]);
    k = prev[k];
  }
  result.reverse();
  return result;
}

/**
 * "set" mode: emit each run as-is. Modified lines surface as separate
 * `removed` + `added` — appropriate once the input has been sorted.
 */
function reconstructSet(ops: Op[], left: readonly string[], right: readonly string[]): DiffRow[] {
  const rows: DiffRow[] = [];
  let lc = 0;
  let rc = 0;
  for (const { op, n } of ops) {
    if (op === INSERT) {
      for (let i = 0; i < n; i++) rows.push({ status: "added", right: right[rc++] });
    } else if (op === DELETE) {
      for (let i = 0; i < n; i++) rows.push({ status: "removed", left: left[lc++] });
    } else {
      for (let i = 0; i < n; i++) rows.push({ status: "unchanged", left: left[lc++], right: right[rc++] });
    }
  }
  return rows;
}

/** A removed+added pair is only reported as `changed` when the two lines are at
 *  least this similar. Conservative on purpose: below this they're a genuine
 *  removal + addition, so we never claim an edit that isn't clearly one. */
const SIMILARITY_THRESHOLD = 0.6;

/**
 * "positional" mode: within a modified block, a removed line is reported as
 * `changed` (paired with an added line) ONLY if the two are actually similar;
 * lines that just happen to sit at the same position but are unrelated stay as
 * separate `removed` + `added`, so the tool never claims an edit that isn't one.
 *
 * This only affects *labelling*: every removed line still appears once (as the
 * left of a `changed` row or as a `removed` row) and every added line once, in
 * their original order — so the categories remain a correct, complete, ordered
 * partition of the diff.
 *
 * A block with no similar pairs (a wholesale replacement) is emitted as a clean
 * removed-block then added-block, like VS Code. A block that DOES contain some
 * genuine edits is emitted in positional order (changed rows inline, unrelated
 * pairs as an adjacent removed + added) so left/right lines never reorder.
 */
function reconstructPositional(
  ops: Op[],
  left: readonly string[],
  right: readonly string[],
  pairChanged: boolean,
): DiffRow[] {
  const rows: DiffRow[] = [];
  let lc = 0;
  let rc = 0;
  let pendingRemoved: string[] = [];
  let pendingAdded: string[] = [];

  const flush = () => {
    const removed = pendingRemoved;
    const added = pendingAdded;
    pendingRemoved = [];
    pendingAdded = [];

    // Strict (git-style): never pair — an edit is a removed line + an added line.
    if (!pairChanged) {
      for (const line of removed) rows.push({ status: "removed", left: line });
      for (const line of added) rows.push({ status: "added", right: line });
      return;
    }

    const paired = Math.min(removed.length, added.length);
    const similar: boolean[] = [];
    let anySimilar = false;
    for (let i = 0; i < paired; i++) {
      similar[i] = similarLines(removed[i], added[i]);
      anySimilar = anySimilar || similar[i];
    }

    if (!anySimilar) {
      // Wholesale replacement: removed block, then added block (order intact).
      for (const line of removed) rows.push({ status: "removed", left: line });
      for (const line of added) rows.push({ status: "added", right: line });
      return;
    }

    // Mixed block: keep positional order. Similar pairs are `changed`; unrelated
    // pairs become an adjacent removed + added rather than a false `changed`.
    for (let i = 0; i < paired; i++) {
      if (similar[i]) {
        rows.push({ status: "changed", left: removed[i], right: added[i] });
      } else {
        rows.push({ status: "removed", left: removed[i] });
        rows.push({ status: "added", right: added[i] });
      }
    }
    for (let i = paired; i < removed.length; i++) {
      rows.push({ status: "removed", left: removed[i] });
    }
    for (let i = paired; i < added.length; i++) {
      rows.push({ status: "added", right: added[i] });
    }
  };

  for (const { op, n } of ops) {
    if (op === DELETE) {
      for (let i = 0; i < n; i++) pendingRemoved.push(left[lc++]);
    } else if (op === INSERT) {
      for (let i = 0; i < n; i++) pendingAdded.push(right[rc++]);
    } else {
      flush();
      for (let i = 0; i < n; i++) rows.push({ status: "unchanged", left: left[lc++], right: right[rc++] });
    }
  }
  flush();
  return rows;
}

/**
 * Are two lines similar enough to call one a `changed` version of the other?
 *
 * Uses character-bigram overlap (Sørensen–Dice) on a normalized form (trimmed,
 * lower-cased, whitespace collapsed). Bigrams compare *structure*, so:
 *  - a value edit in an otherwise-identical line scores high → `changed`;
 *  - two lines that merely share a keyword or a coincidental value/number score
 *    low → they stay separate `removed` + `added` (no fabricated edit);
 *  - punctuation-only or repeated-word lines don't get a false full-match.
 * Conservative by design: when in doubt it reports "not similar".
 */
function similarLines(a: string, b: string): boolean {
  const na = normalizeForSimilarity(a);
  const nb = normalizeForSimilarity(b);
  if (na === nb) {
    return true; // identical once normalized (e.g. only case/whitespace differs)
  }
  const countA = na.length - 1;
  const countB = nb.length - 1;
  if (countA < 1 || countB < 1) {
    return false; // a line shorter than 2 chars, and they aren't equal → unrelated
  }

  // Multiset intersection of adjacent character pairs.
  const grams = new Map<string, number>();
  for (let i = 0; i + 1 <= na.length - 1; i++) {
    const gram = na.slice(i, i + 2);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  let common = 0;
  for (let i = 0; i + 1 <= nb.length - 1; i++) {
    const gram = nb.slice(i, i + 2);
    const count = grams.get(gram);
    if (count && count > 0) {
      common++;
      grams.set(gram, count - 1);
    }
  }
  return (2 * common) / (countA + countB) >= SIMILARITY_THRESHOLD;
}

/** Normalize a line for similarity: trim, lower-case, collapse whitespace runs. */
function normalizeForSimilarity(line: string): string {
  return line.trim().toLowerCase().replace(/\s+/g, " ");
}

/* ------------------------------------------------------------------ *
 * Key-based reconciliation (enables `changed`)
 * ------------------------------------------------------------------ */

function diffByKey(
  left: readonly string[],
  right: readonly string[],
  key: ColumnSpec,
  normalize: (s: string) => string,
): DiffRow[] {
  const keyOf = (line: string) => normalize(extractColumn(line, key));
  const leftGroups = groupByKey(left, keyOf);
  const rightGroups = groupByKey(right, keyOf);

  // Deterministic output: walk the union of keys in sorted order.
  const keys = [...new Set([...leftGroups.keys(), ...rightGroups.keys()])].sort();

  const rows: DiffRow[] = [];
  for (const k of keys) {
    const leftLines = leftGroups.get(k) ?? [];
    const rightLines = rightGroups.get(k) ?? [];
    const pairs = Math.max(leftLines.length, rightLines.length);

    // Pair rows sharing a key positionally; leftovers are added/removed.
    for (let i = 0; i < pairs; i++) {
      const leftLine = leftLines[i];
      const rightLine = rightLines[i];

      if (leftLine !== undefined && rightLine !== undefined) {
        const status: DiffStatus =
          normalize(leftLine) === normalize(rightLine) ? "unchanged" : "changed";
        rows.push({ status, left: leftLine, right: rightLine });
      } else if (leftLine !== undefined) {
        rows.push({ status: "removed", left: leftLine });
      } else if (rightLine !== undefined) {
        rows.push({ status: "added", right: rightLine });
      }
    }
  }
  return rows;
}

function groupByKey(
  lines: readonly string[],
  keyOf: (line: string) => string,
): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const line of lines) {
    const k = keyOf(line);
    const bucket = groups.get(k);
    if (bucket) {
      bucket.push(line);
    } else {
      groups.set(k, [line]);
    }
  }
  return groups;
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/**
 * Build a normalizer that applies trim/lower-case for equality checks, caching
 * per unique string so we don't re-normalize the same line many times during a
 * large comparison.
 */
function makeNormalizer(trim: boolean, caseInsensitive: boolean): (s: string) => string {
  const cache = new Map<string, string>();
  return (s: string) => {
    const cached = cache.get(s);
    if (cached !== undefined) {
      return cached;
    }
    let n = s;
    if (trim) n = n.trim();
    if (caseInsensitive) n = n.toLowerCase();
    cache.set(s, n);
    return n;
  };
}

function summarize(rows: readonly DiffRow[]): DiffSummary {
  const summary: DiffSummary = {
    unchanged: 0,
    added: 0,
    removed: 0,
    changed: 0,
    total: rows.length,
  };
  for (const row of rows) {
    summary[row.status]++;
  }
  return summary;
}

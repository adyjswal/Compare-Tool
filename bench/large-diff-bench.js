/*
 * Benchmark the engine's diff on realistic large inputs, and write sample file
 * pairs so you can eyeball VS Code's built-in diff (and this extension) on the
 * same data.
 *
 *   node bench/large-diff-bench.js
 *
 * Generates CSV records `id,name,dept,salary`. The "right" side is the "left"
 * side with ~2% changed, ~1% removed, ~1% added, rest unchanged (a realistic
 * "same file, some edits" diff, not two random files).
 */
const { diffLines } = require("@large-file-compare/engine");
const { writeFileSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");

// Simple seeded PRNG so runs are reproducible.
let seed = 123456789;
function rnd() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}

const DEPTS = ["Engineering", "Sales", "Marketing", "Finance", "Support", "Legal"];
function record(id) {
  const dept = DEPTS[id % DEPTS.length];
  const salary = 40000 + ((id * 37) % 60000);
  return `${id},Name${id},${dept},${salary}`;
}

function makePair(n) {
  const left = new Array(n);
  for (let i = 0; i < n; i++) left[i] = record(i + 1);
  const right = [];
  for (let i = 0; i < n; i++) {
    const r = rnd();
    if (r < 0.01) continue; // 1% removed
    if (r < 0.03) {
      // 2% changed: bump the salary field
      const parts = left[i].split(",");
      parts[3] = String(Number(parts[3]) + 1000);
      right.push(parts.join(","));
    } else {
      right.push(left[i]);
    }
    if (r > 0.99) right.push(`${1_000_000 + i},NameNew${i},Support,50000`); // ~1% added
  }
  return { left, right };
}

function fmtBytes(b) {
  return `${(b / 1024 / 1024).toFixed(0)} MB`;
}

function bench(n) {
  const { left, right } = makePair(n);
  if (global.gc) global.gc();
  const before = process.memoryUsage().rss;
  const t0 = process.hrtime.bigint();
  const result = diffLines(left, right, { trim: true, caseInsensitive: true, pairChanged: true });
  const t1 = process.hrtime.bigint();
  const after = process.memoryUsage().rss;
  const ms = Number(t1 - t0) / 1e6;
  const s = result.summary;
  console.log(
    `${n.toLocaleString().padStart(11)} lines  |  ${ms.toFixed(0).padStart(6)} ms  |  ` +
      `rows ${s.total.toLocaleString()}  (chg ${s.changed}, +${s.added}, -${s.removed})  |  ` +
      `RSS +${fmtBytes(after - before)}`,
  );
  return { left, right };
}

console.log("engine diff benchmark (positional, pairChanged, ignore-whitespace)\n");
const sizes = [100_000, 250_000, 500_000, 1_000_000, 2_000_000];
let sample = null;
for (const n of sizes) {
  const pair = bench(n);
  if (n === 1_000_000) sample = pair; // keep the 1M pair to write to disk
}

// Write the 1M-line pair for manual testing.
const dir = join(__dirname, "data");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "left_1m.csv"), sample.left.join("\n") + "\n");
writeFileSync(join(dir, "right_1m.csv"), sample.right.join("\n") + "\n");
console.log(`\nWrote sample pair to bench/data/left_1m.csv + right_1m.csv (${sample.left.length.toLocaleString()} / ${sample.right.length.toLocaleString()} lines)`);

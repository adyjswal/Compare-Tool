/*
 * Generates a small, committable sample file pair for testers to try the
 * extension on immediately (no need to find their own big files).
 *
 *   node samples/make-samples.js
 *
 * Writes employees_left.csv / employees_right.csv (~250k rows each, ~7 MB) of
 * `id,name,dept,salary` records. The "right" side is the "left" with ~2%
 * changed, ~1% removed, ~1% added — a realistic "same data, some edits" diff.
 */
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");

const N = 250_000;

// Seeded PRNG so the sample is reproducible run-to-run.
let seed = 987654321;
function rnd() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}

const DEPTS = ["Engineering", "Sales", "Marketing", "Finance", "Support", "Legal"];
function record(id) {
  return `${id},Name${id},${DEPTS[id % DEPTS.length]},${40000 + ((id * 37) % 60000)}`;
}

const left = new Array(N);
for (let i = 0; i < N; i++) left[i] = record(i + 1);

const right = [];
for (let i = 0; i < N; i++) {
  const r = rnd();
  if (r < 0.01) continue; // ~1% removed
  if (r < 0.03) {
    const parts = left[i].split(",");
    parts[3] = String(Number(parts[3]) + 1000); // ~2% changed (salary)
    right.push(parts.join(","));
  } else {
    right.push(left[i]);
  }
  if (r > 0.99) right.push(`${1_000_000 + i},NameNew${i},Support,50000`); // ~1% added
}

const dir = __dirname;
writeFileSync(join(dir, "employees_left.csv"), left.join("\n") + "\n");
writeFileSync(join(dir, "employees_right.csv"), right.join("\n") + "\n");
console.log(
  `Wrote samples/employees_left.csv (${left.length.toLocaleString()} rows) + ` +
    `employees_right.csv (${right.length.toLocaleString()} rows)`,
);

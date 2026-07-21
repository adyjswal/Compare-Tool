# Testing Large File Compare (v0.1.1)

Thanks for trying this out! It takes ~2 minutes. Works on **Windows, macOS, and Linux**,
VS Code **1.90+**.

## Install

You'll be given a file named `large-file-compare-0.1.1.vsix`.

1. In VS Code, open the Extensions view (`Ctrl+Shift+X`).
2. Click the `⋯` menu at the top-right of the panel → **Install from VSIX…**.
3. Select the `.vsix` file. (Or from a terminal: `code --install-extension large-file-compare-0.1.1.vsix`.)
4. Reload if prompted.

## Try it

**Quickest:** Ctrl/Cmd-click **two files** in the Explorer → right-click →
**Diff Selected (Large File Compare)**.

Good files to try:
- The included samples: `samples/employees_left.csv` and `samples/employees_right.csv`
  (~250k rows each — for a bigger stress test, see "Generate larger files" below).
- Your own large exports: SQL dumps, CSV/TSV data, log files, `.properties`/config files.

Things worth poking at:
- The **Unchanged** toggle: *All* / *Collapsed* (foldable "⋯ N unchanged lines") / *Only changes*.
- **Find** (top-left box), and the colored **summary chips** to jump between changes.
- **Sort** (compare after sorting) and **Compare by key column** (match rows by a column, e.g.
  column 1 as an ID — great for reordered CSV/SQL exports).
- **Export** (top-right) to CSV/text; right-click a row to **copy** it.
- For contrast, compare the **same two files with VS Code's built-in diff** (select two →
  right-click → *Compare Selected*) and see the difference on large files.

## Uninstall

Extensions view → search `@installed large file compare` → gear icon → **Uninstall**.

## What to report back

- Your **OS** and VS Code version.
- Did it **install cleanly**?
- **File sizes** you tried and how it felt — load time, scrolling smoothness.
- Anything **broken, slow, or confusing**.
- Did it **beat the built-in diff** for your use case? Would you actually use it?

## Generate larger files (optional)

Want to stress it at 1M+ lines?

```bash
node bench/large-diff-bench.js   # benchmarks + writes bench/data/left_1m.csv + right_1m.csv
```

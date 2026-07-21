# Large File Compare

Sort and compare **very large text files** (200k–1M+ lines) — SQL exports, structured
property/config files, CSV dumps — where VS Code's built-in diff editor struggles. It
replaces the "sort in Excel, paste into VS Code, eyeball it" workaround.

The read + diff runs in a worker thread with streamed reading, progress, and a Cancel
button, and the view is fully virtualized (only the visible rows are in the DOM), so it
stays smooth at a million lines.

## Getting started

1. Open the Command Palette (`Ctrl+Shift+P`) → **Large File Compare: Compare Two Files**,
   and pick two text files. Or right-click a file in the Explorer → **Select for Compare
   (Large File)**, then right-click another → **Compare with Selected (Large File)**.
2. A side-by-side diff panel opens with a summary of unchanged / changed / removed / added.

## Features

- **Compare as-is** or **sort first** (alphabetical / numeric, asc/desc), or **compare by a
  key column** (pick a delimiter + 1-based column) — matching keys with different content
  show as `changed`.
- **Unchanged rows view** — one control:
  - **All** — every row.
  - **Collapsed** — GitHub-style folds ("⋯ 10,000 unchanged lines", click to expand).
  - **Only changes** — hide unchanged rows entirely, so a 900k-row file collapses to just
    its differences.
- **Find** on either side — matches highlighted inline; step through with Enter / Shift+Enter
  or the nav bar.
- **Navigate** by category — click a summary chip to jump through added / removed / changed
  rows; an overview ruler (change map) down the right edge is click-to-jump.
- **Export** the diff to **CSV** or **plain text** (changed rows only, or all rows).
- **Copy** a row — right-click for *Copy left / Copy right / Copy row (both)*, or select a
  row and press `Ctrl/Cmd+C`.
- Two panes scroll in **lock-step** (vertical *and* horizontal), like VS Code's diff.

## Requirements

- VS Code 1.90+

## Known limitations

- Comparison is case-insensitive and (by default) ignores leading/trailing whitespace;
  toggle **Ignore whitespace** off to compare spacing exactly.
- Binary files are detected and rejected — pick text files.

## Release notes

See [CHANGELOG.md](CHANGELOG.md).

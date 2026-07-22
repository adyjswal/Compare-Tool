# Large File Compare

[![CI](https://github.com/adyjswal/Compare-Tool/actions/workflows/ci.yml/badge.svg)](https://github.com/adyjswal/Compare-Tool/actions/workflows/ci.yml)
[![VS Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/adityakumar0406.large-file-compare?label=Marketplace)](https://marketplace.visualstudio.com/items?itemName=adityakumar0406.large-file-compare)
[![Open VSX Version](https://img.shields.io/open-vsx/v/AdityaKumar0406/large-file-compare?label=Open%20VSX)](https://open-vsx.org/extension/AdityaKumar0406/large-file-compare)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/adityakumar0406.large-file-compare)](https://marketplace.visualstudio.com/items?itemName=adityakumar0406.large-file-compare)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](extension/LICENSE)

**Install:** [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=adityakumar0406.large-file-compare) — or in VS Code, open Extensions (`Ctrl+Shift+X`) and search **Large File Compare**.

## Availability

| Registry | Link |
| --- | --- |
| VS Code Marketplace | [AdityaKumar0406.large-file-compare](https://marketplace.visualstudio.com/items?itemName=adityakumar0406.large-file-compare) |
| Open VSX Registry | [AdityaKumar0406/large-file-compare](https://open-vsx.org/extension/AdityaKumar0406/large-file-compare) |

> **Desktop-only.** The extension uses Node.js `worker_threads` for background processing.
> It will not run in browser-based editors (e.g. vscode.dev / github.dev).

> **CI secrets required.** The release workflow (`release.yml`) publishes to both registries
> automatically when a `v*.*.*` tag is pushed. Before tagging a release, add two secrets in
> **GitHub → Settings → Secrets and variables → Actions**:
>
> | Secret | Purpose |
> | --- | --- |
> | `VSCE_PAT` | Personal Access Token for the VS Code Marketplace (scope: *Marketplace: Manage*) |
> | `OVSX_PAT` | Personal Access Token for the Open VSX Registry |

A VS Code extension that **sorts and compares very large text files** (200k–2M lines) —
SQL exports, structured property/config files, CSV dumps, and the like — where VS Code's
built-in diff editor struggles. It replaces the "sort in Excel, paste into VS Code,
eyeball it" workaround.

On a 1M-line CSV pair, VS Code's built-in diff took **30–40 s**, lagged, and dropped the
side-by-side view; this renders side-by-side in **~5 s** and scrolls smoothly. It also does
two things the built-in can't do at any size: **sort-then-compare** (for unordered exports)
and **key-column compare** (match rows by an ID field, to reconcile reordered dumps).

## Repository layout

This is an **npm workspaces monorepo** with two packages:

```text
.
├── engine/       Pure TypeScript core — reading, sorting, diffing, filtering.
│                 NO dependency on `vscode`. Reusable by future IDE plugins
│                 (IntelliJ, Eclipse, ...).
├── extension/    The VS Code wrapper — commands, file pickers, and (later) the
│                 React + react-window webview UI. Calls into `engine/` for all
│                 real work.
├── tsconfig.base.json   Shared compiler options for the Node side.
└── package.json         Workspace root + top-level scripts.
```

The hard rule: **`engine/` never imports `vscode`.** That separation is what keeps the
core logic portable to other editors.

## Prerequisites

- Node.js 18+ (developed on Node 24)
- VS Code 1.90+

## Getting started

```bash
# From the repo root — installs deps for BOTH workspaces and links them together.
npm install

# Build the engine, then bundle the extension.
npm run compile
```

### Run the extension

Open this folder in VS Code and press **F5** (uses `.vscode/launch.json`). That runs the
`compile` build task and launches a second VS Code window — the **Extension Development
Host** — with the extension loaded.

In that window, open the Command Palette (`Ctrl+Shift+P`) and run
**“Large File Compare: Compare Two Files”**. Pick two text files and a **Large File
Compare** panel opens showing the diff in a virtualized list — only the visible rows
are in the DOM, so it stays smooth at 200k–1M lines — with a header summary
(unchanged / changed / removed / added).

The read + diff runs in a **worker thread** (streamed reading, progress, and a Cancel
button), so VS Code never freezes on huge files. The diff itself is tuned for scale:
lines are interned to integers and the common prefix/suffix is trimmed before diffing.

In the panel you can:

- **Compare as-is** (default) or **sort** first (alphabetical / numeric, asc/desc),
  or **compare by a key column** (pick a delimiter + 1-based column) — matching keys
  with different content show as `changed`, the "sort-and-eyeball-in-Excel" replacement.
- Choose an **unchanged-rows view**: *All*, *Collapsed* (GitHub-style expandable
  "⋯ N unchanged lines" folds), or *Only changes* (hide unchanged rows entirely, so a
  900k-row file collapses to just its differences).
- **Find** text on either side: matches are highlighted inline and you step through them
  with the ◂ ▸ buttons or Enter / Shift+Enter.
- **Navigate** by category: click a summary chip to jump to the next row of that status
  (Shift+click for previous).
- **Export** the diff to CSV or plain text (changed rows only, or all rows), and **copy**
  a row (right-click → Copy left / right / both, or select + Ctrl/Cmd+C).
- Scroll the two panes in **lock-step** (vertical *and* horizontal), like VS Code's diff.

## Useful scripts (run from the repo root)

| Command | What it does |
| --- | --- |
| `npm run compile` | Build engine, then bundle the extension. |
| `npm run build:engine` | Compile the engine only (`tsc` → `engine/dist`). |
| `npm run build:extension` | Bundle the extension only (esbuild → `extension/dist`). |
| `npm run check-types` | Type-check the extension without emitting. |
| `npm test` | Run the engine's Vitest suite (added in phase 1). |

Per-package watch modes are also available:
`npm run watch --workspace @large-file-compare/engine` and
`npm run watch --workspace large-file-compare`.

## Build roadmap

- **Phase 0 — Scaffold** ✅ monorepo, extension skeleton, build/run wiring.
- **Phase 1 — Engine** ✅ reader, sorter, differ, filter as pure functions + Vitest tests.
- **Phase 2 — Command** ✅ file pickers → engine → summary, inside the extension host.
- **Phase 3 — Webview** ✅ React + react-window virtualized diff view.
- **Phase 4 — Controls** ✅ sort options + find/search box wired back into the engine.
- **Phase 5 — Polish** ✅ loading/progress states + error handling (missing/empty/binary/identical).
- **Phase 6a — Performance** ✅ worker thread, streamed reading, line interning +
  prefix/suffix trimming, compact columnar payload, progress + cancel — targets 1M lines.
- **Phase 6b — Key-column compare** ✅ match rows by a delimited key column (SQL/CSV).
- **Phase 7 — Views + export** ✅ unchanged-rows view (all / collapsed folds / only changes),
  export to CSV/text, copy a row, and a packaged `.vsix`.

### Possible future work

- **Density-shaded overview ruler** — shade each pixel by *how many* changes fall in it, so
  "changes everywhere" reads differently from "a dense cluster here" (the current map
  saturates to solid red/green when edits are dense and evenly spread across a huge file).
- **Partial fold expansion** — GitHub-style "expand up / down" on a collapsed run, instead of
  expanding the whole run at once.

## Notes

- `publisher` in `extension/package.json` is `AdityaKumar0406` (the Marketplace publisher).
  Publishing needs a PAT with the *Marketplace: Manage* scope (see below).
- Package to a `.vsix`: `npm run vsix` from the `extension/` folder (builds production bundles,
  then runs `vsce package --no-dependencies` since deps are bundled by esbuild). Install it with
  `code --install-extension extension/large-file-compare-0.1.0.vsix` or the Extensions view's
  "Install from VSIX…".
- The extension's own README / CHANGELOG / LICENSE (marketplace copy) live in `extension/`.

# Large File Compare

A VS Code extension that **sorts and compares very large text files** (200,000–300,000
lines) — SQL exports, structured property/config files, and the like — where VS Code's
built-in diff editor struggles. It replaces the "sort in Excel, paste into VS Code,
eyeball it" workaround.

## Repository layout

This is an **npm workspaces monorepo** with two packages:

```
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
- **Find** text on either side: matches are highlighted inline and you step through them
  with the ◂ ▸ buttons or Enter / Shift+Enter; "Only matches" hides the rest.
- **Navigate** by category: click a summary chip to jump to the next row of that status
  (Shift+click for previous).
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

## Notes

- `publisher` in `extension/package.json` is a placeholder (`your-publisher-id`). Set a
  real publisher id before packaging or publishing to the Marketplace.
- Packaging to a `.vsix` later: `npx @vscode/vsce package` from the `extension/` folder.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A VS Code extension, **Large File Compare**, for diffing/sorting very large text files
(200k–2M lines: SQL/CSV exports, logs, config) that VS Code's built-in diff editor chokes
on. It renders a virtualized, worker-backed side-by-side diff that stays smooth at ~1M rows.

## Commands

Run from the repo root unless noted. It's an **npm workspaces monorepo** (`engine`, `extension`).

```bash
npm install                 # install + link both workspaces
npm run compile             # build engine (tsc), THEN bundle extension (esbuild) — see ordering note
npm run build:engine        # engine only  → engine/dist
npm run build:extension     # extension only (esbuild → extension/dist)
npm run check-types         # type-check extension host + webview (tsc --noEmit, no emit)
npm test                    # vitest in every workspace (engine + extension)
```

Extension packaging / dev (run from `extension/`):

```bash
npm run watch               # esbuild watch (host + worker + webview)
npm run vsix                # production build + `vsce package --no-dependencies` → .vsix
npm run icon                # regenerate media/icon.png (scripts/make-icon.js, no deps)
```

Tests use **Vitest**. Run a single file / test:

```bash
cd extension && npx vitest run test/rowModel.test.ts        # one file
cd engine    && npx vitest run -t "diffByKey"               # by test name
```

**Run the extension:** press **F5** in VS Code → launches the Extension Development Host with
the extension loaded. There is no automated UI/E2E test harness — verify UI changes via F5.

### Build ordering gotcha

The extension bundle imports `@large-file-compare/engine`, which resolves to `engine/dist`
(its `main`). So **the engine must be built before bundling the extension** — always use
`npm run compile` (or `build:engine` first). `esbuild.js` bundles the engine source into the
output, so nothing from `node_modules` ships at runtime.

## Architecture

### Two packages, one hard rule

- `engine/` — pure TypeScript core (reading, sorting, diffing, filtering). **NEVER import
  `vscode` or any editor API here.** This separation is deliberate: the engine is meant to
  back other IDE plugins later.
- `extension/` — the VS Code wrapper. All UI and VS Code integration; calls into `engine/`.

### Three runtime contexts (bundled separately in `extension/esbuild.js`)

1. **Extension host** — `src/extension.ts`, `src/commands/*`, `src/panel/diffPanel.ts`. Node,
   inside VS Code. Owns panels, sessions, and the full diff result.
2. **Diff worker** — `src/worker/diffWorker.ts`. A Node `worker_thread` so the heavy
   read+sort+diff never blocks VS Code. **Stateful**: reads both files once (streamed) and
   keeps their line arrays, so a `recompute` (new sort/key) doesn't re-read from disk.
3. **Webview** — `webview/*.tsx` (React). Runs in the browser-like sandbox.

Two message contracts define the boundaries: `src/worker/messages.ts` (host ↔ worker) and
`src/protocol.ts` (host ↔ webview).

### The core scaling invariant (read this before touching the data flow)

**The webview never holds all the text.** The host (`diffPanel.ts`) keeps the full result in
`session.result`; it pushes only the per-row **status column** (`Uint8Array`, ~1 byte/row) to
the webview. The webview requests line text **on demand, one visible window at a time**
(`getWindow`), caches it, and renders only visible rows. Consequently:

- **Find** and **Export** run on the **host** (it has all the text), returning row indices /
  writing files — never ship the full text to the webview.
- Results cross host↔worker as a **columnar** `ColumnarResult` (parallel `statuses`/`lefts`/
  `rights` arrays, `statuses` transferred as an ArrayBuffer), not per-row objects, so
  structured-clone stays cheap at 1M rows and never approaches its ~512MB ceiling.

This is what lets the tool scale past ~1M rows. Preserve it.

### Per-comparison sessions

Each comparison opens its own panel + its own worker + a `Session` (tracked in a `Set` in
`diffPanel.ts`), so several comparisons run independently. A monotonic `requestId` guards
against stale results when a reload/swap/recompute supersedes an in-flight request.

### Webview specifics

- **Scaled scrolling** (`webview/scrollMapping.ts`): browsers refuse to render an element past
  a max height (tens of millions of px). The virtualizer caps the scroll element and maps
  scroll position ↔ row index *proportionally*, so every row stays reachable at 1M+ rows.
  Pure math, unit-tested in `test/scrollMapping.test.ts` — change carefully.
- **Display-row model** (`webview/rowModel.ts`): maps a *display index* → an absolute row or a
  **fold marker**, powering the "unchanged rows" view (`all` / `collapsed` / `changes`). Folds
  render as one fixed-height row so the virtualizer is unaffected. Tested in
  `test/rowModel.test.ts`. `App.tsx` keeps `currentIndex` in absolute space and translates to
  display space via the model.
- `DiffList.tsx` holds the virtualizer, the two scroll-synced panes, the overview ruler
  (a canvas change-map, in display space), fold rendering, the copy context menu, and Ctrl/⌘+C.

### Diff modes (`engine/src/differ.ts`, selected in `diffWorker.compute()`)

Precedence is **key > sorted(set) > positional**:

- **positional** (default): line-by-line; a removed line paired with a similar added line
  becomes one `changed` row.
- **set**: used after sorting; no pairing (a modified line stays as separate removed + added).
- **key-column**: match rows by one delimited column (record reconciliation) — same key +
  different content = `changed`. Exposed in the toolbar via a delimiter + 1-based column input.

## Packaging notes

Because esbuild bundles React and the engine into `dist/`, **all runtime deps live in
`devDependencies`** and `vsce` is invoked with `--no-dependencies`. `.vscodeignore` ships only
`dist/` + manifest + docs + `media/icon.png`. The `publisher` in `extension/package.json` is a
placeholder until a real Marketplace publisher id is set.

## Git

Work is committed directly on `main` (there is no PR/branch flow in use here, and edits are
committed automatically). `origin` points at an internal GitHub Enterprise remote; a public
`personal` remote may also be configured for Marketplace publishing.

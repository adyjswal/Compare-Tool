# Change Log

All notable changes to the **Large File Compare** extension are documented here.

## [0.2.0]

- Marketplace icon regenerated at 256×256 for crisp rendering on high-DPI displays.
- Coordinated release: **Large File Compare is now available on JetBrains IDEs and Eclipse**
  as native plugins with the same core compare/sort/find/export feature set. No functional
  change to the VS Code extension itself in this release.

## [0.1.3]

- Docs: added a screenshot of the side-by-side diff to the Marketplace listing.

## [0.1.2]

- Docs: clearer Marketplace listing — a compare-mode guide (as-is / sort-first / key-column,
  with an example), a panel orientation, and the ⇄ swap button named.
- Clarified that comparison is **always case-insensitive** (there is no case-sensitive toggle yet).

## [0.1.1]

- **Unchanged rows view**: a 3-way control — *All*, *Collapsed* (GitHub-style expandable
  "⋯ N unchanged lines" folds), and *Only changes* (hide unchanged rows entirely).
- **Export** the diff to CSV or plain text, for changed rows only or all rows.
- **Copy from a pane**: right-click a row for *Copy left / right / both*, or select a row
  and press `Ctrl/Cmd+C`.
- **Explorer compare**: right-click two Ctrl/Cmd-selected files → *Diff Selected (Large File
  Compare)*. Renamed the menu items (distinct from VS Code's built-in "Compare Selected") and
  made the two-step *Select for Diff* / *Diff with Selected* one-shot so it no longer lingers.
- First packaged (`.vsix`) release.

## [0.0.1]

- Initial internal build: worker-threaded streamed read + diff, virtualized side-by-side
  view (scales to ~1M lines), sort / key-column compare, find, category navigation, and an
  overview ruler.

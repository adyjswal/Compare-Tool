# Change Log

All notable changes to the **Large File Compare** extension are documented here.

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

# Change Log

Release notes for the **Large File Compare** VS Code extension. The authoritative,
extension-bundled log is [extension/CHANGELOG.md](extension/CHANGELOG.md).

## [0.1.3]

- Docs: added a screenshot of the side-by-side diff to the Marketplace listing.

## [0.1.2]

- Docs: clearer Marketplace listing (compare-mode guide + key-column example, panel
  orientation, named the ⇄ swap button) and clarified that comparison is always
  case-insensitive.

## [0.1.1]

- **Unchanged-rows view** — a 3-way control: *All*, *Collapsed* (GitHub-style expandable
  "⋯ N unchanged lines" folds), and *Only changes* (hide unchanged rows entirely).
- **Export** the diff to CSV or plain text (changed rows only, or all rows).
- **Copy from a pane** — right-click a row for *Copy left / right / both*, or select + `Ctrl/Cmd+C`.
- **Explorer compare** — right-click two Ctrl/Cmd-selected files → *Diff Selected (Large File
  Compare)*; renamed menu items (distinct from VS Code's built-in) and made the two-step
  *Select for Diff* / *Diff with Selected* one-shot.
- First packaged and **published** release.

## [0.0.1]

- Initial internal build: worker-threaded streamed read + diff, virtualized side-by-side view
  (scales to ~1M lines), sort / key-column compare, find, category navigation, overview ruler.

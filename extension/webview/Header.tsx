import type { DiffResultMessage } from "../src/protocol";
import type { DiffStatus } from "@large-file-compare/engine";
import type { ViewMode } from "./DiffList";

interface HeaderProps {
  data: DiffResultMessage;
  mode: ViewMode;
  onModeChange: (mode: ViewMode) => void;
}

/** Top bar: file names, per-category counts, and the layout toggle. */
export function Header({ data, mode, onModeChange }: HeaderProps) {
  const { left, right, summary } = data;
  return (
    <header className="header">
      <div className="files">
        <span className="file">{left.name}</span>
        <span className="vs">vs</span>
        <span className="file">{right.name}</span>
      </div>

      <div className="header-right">
        <div className="chips">
          <Chip status="unchanged" value={summary.unchanged} />
          <Chip status="changed" value={summary.changed} />
          <Chip status="removed" value={summary.removed} />
          <Chip status="added" value={summary.added} />
        </div>

        <div className="view-toggle" role="group" aria-label="Layout">
          <button
            type="button"
            className={mode === "sideBySide" ? "active" : ""}
            onClick={() => onModeChange("sideBySide")}
          >
            Side-by-side
          </button>
          <button
            type="button"
            className={mode === "unified" ? "active" : ""}
            onClick={() => onModeChange("unified")}
          >
            Unified
          </button>
        </div>
      </div>
    </header>
  );
}

function Chip({ status, value }: { status: DiffStatus; value: number }) {
  return (
    <span className={`chip chip-${status}`}>
      {value.toLocaleString()} {status}
    </span>
  );
}

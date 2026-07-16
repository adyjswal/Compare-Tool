import type { DiffResultMessage } from "../src/protocol";
import type { DiffStatus } from "@large-file-compare/engine";
import type { ViewMode } from "./DiffList";

interface HeaderProps {
  data: DiffResultMessage;
  mode: ViewMode;
  onModeChange: (mode: ViewMode) => void;
  /** Jump through visible rows of this status: +1 = next, -1 = previous. */
  onNavigate: (status: DiffStatus, direction: 1 | -1) => void;
  /** How many rows of each status are currently visible (for enabling chips). */
  navCounts: Record<DiffStatus, number>;
}

/** Top bar: file names, per-category counts, and the layout toggle. */
export function Header({ data, mode, onModeChange, onNavigate, navCounts }: HeaderProps) {
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
          <Chip status="unchanged" value={summary.unchanged} navCount={navCounts.unchanged} onNavigate={onNavigate} />
          <Chip status="changed" value={summary.changed} navCount={navCounts.changed} onNavigate={onNavigate} />
          <Chip status="removed" value={summary.removed} navCount={navCounts.removed} onNavigate={onNavigate} />
          <Chip status="added" value={summary.added} navCount={navCounts.added} onNavigate={onNavigate} />
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

function Chip({
  status,
  value,
  navCount,
  onNavigate,
}: {
  status: DiffStatus;
  value: number;
  navCount: number;
  onNavigate: (status: DiffStatus, direction: 1 | -1) => void;
}) {
  const disabled = navCount === 0;
  return (
    <button
      type="button"
      className={`chip chip-${status}`}
      disabled={disabled}
      title={
        disabled
          ? `No ${status} rows in view`
          : `Click: next ${status} row · Shift+click: previous (${navCount})`
      }
      onClick={(event) => onNavigate(status, event.shiftKey ? -1 : 1)}
    >
      {value.toLocaleString()} {status}
    </button>
  );
}

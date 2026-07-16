import type { FileInfo } from "../src/protocol";
import type { DiffStatus, DiffSummary } from "@large-file-compare/engine";
import type { ViewMode } from "./DiffList";

/** Just the parts of a comparison the header renders. */
interface HeaderData {
  left: FileInfo;
  right: FileInfo;
  summary: DiffSummary;
}

interface HeaderProps {
  data: HeaderData;
  mode: ViewMode;
  onModeChange: (mode: ViewMode) => void;
  /** Start navigating rows of this status (jumps to the first, opens the nav bar). */
  onNavigate: (status: DiffStatus) => void;
  /** How many rows of each status are currently visible (for enabling chips). */
  navCounts: Record<DiffStatus, number>;
  /** Re-read both files from disk and re-run the comparison. */
  onReload: () => void;
}

/** Top bar: file names, per-category counts, and the layout toggle. */
export function Header({ data, mode, onModeChange, onNavigate, navCounts, onReload }: HeaderProps) {
  const { left, right, summary } = data;
  return (
    <header className="header">
      <div className="files">
        <button
          type="button"
          className="reload-btn"
          onClick={onReload}
          title="Reload both files from disk and re-compare"
          aria-label="Reload"
        >
          ↻
        </button>
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
  onNavigate: (status: DiffStatus) => void;
}) {
  const disabled = navCount === 0;
  return (
    <button
      type="button"
      className={`chip chip-${status}`}
      disabled={disabled}
      title={disabled ? `No ${status} rows in view` : `Navigate the ${navCount} ${status} rows`}
      onClick={() => onNavigate(status)}
    >
      {value.toLocaleString()} {status}
    </button>
  );
}

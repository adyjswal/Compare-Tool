import type { FileInfo } from "../src/protocol";
import type { DiffStatus, DiffSummary } from "@large-file-compare/engine";

/** Just the parts of a comparison the header renders. */
interface HeaderData {
  left: FileInfo;
  right: FileInfo;
  summary: DiffSummary;
}

interface HeaderProps {
  data: HeaderData;
  /** Start navigating rows of this status (jumps to the first, opens the nav bar). */
  onNavigate: (status: DiffStatus) => void;
  /** How many rows of each status are currently visible (for enabling chips). */
  navCounts: Record<DiffStatus, number>;
  /** Re-read both sides (disk or live editor) and re-compare. */
  onReload: () => void;
  /** Swap which side is source (left) vs target (right). */
  onSwap: () => void;
  /** Open one side's document in an editor tab to edit it. */
  onOpenSide: (side: "left" | "right") => void;
  /** Export the diff (host prompts for CSV/text + scope, then a save dialog). */
  onExport: () => void;
}

/** Top bar: file names and per-category counts. */
export function Header({
  data,
  onNavigate,
  navCounts,
  onReload,
  onSwap,
  onOpenSide,
  onExport,
}: HeaderProps) {
  const { left, right, summary } = data;
  return (
    <header className="header">
      <div className="files">
        <button
          type="button"
          className="reload-btn"
          onClick={onReload}
          title="Reload both sides (picks up edits) and re-compare"
          aria-label="Reload"
        >
          ↻
        </button>
        <button
          type="button"
          className="file-link"
          onClick={() => onOpenSide("left")}
          title={`Open ${left.name} to edit`}
        >
          {left.name}
        </button>
        <button
          type="button"
          className="swap-btn"
          onClick={onSwap}
          title="Swap source / target"
          aria-label="Swap sides"
        >
          ⇄
        </button>
        <button
          type="button"
          className="file-link"
          onClick={() => onOpenSide("right")}
          title={`Open ${right.name} to edit`}
        >
          {right.name}
        </button>
      </div>

      <div className="header-right">
        <div className="chips">
          <Chip status="unchanged" value={summary.unchanged} navCount={navCounts.unchanged} onNavigate={onNavigate} />
          <Chip status="changed" value={summary.changed} navCount={navCounts.changed} onNavigate={onNavigate} />
          <Chip status="removed" value={summary.removed} navCount={navCounts.removed} onNavigate={onNavigate} />
          <Chip status="added" value={summary.added} navCount={navCounts.added} onNavigate={onNavigate} />
        </div>
        <button
          type="button"
          className="export-btn"
          onClick={onExport}
          title="Export the diff to a CSV or text file"
        >
          ⭳ Export
        </button>
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

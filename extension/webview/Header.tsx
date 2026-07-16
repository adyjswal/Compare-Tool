import type { DiffResultMessage } from "../src/protocol";
import type { DiffStatus } from "@large-file-compare/engine";

/** Top bar: the two file names plus color-coded per-category counts. */
export function Header({ data }: { data: DiffResultMessage }) {
  const { left, right, summary } = data;
  return (
    <header className="header">
      <div className="files">
        <span className="file">{left.name}</span>
        <span className="vs">vs</span>
        <span className="file">{right.name}</span>
      </div>
      <div className="chips">
        <Chip status="unchanged" value={summary.unchanged} />
        <Chip status="changed" value={summary.changed} />
        <Chip status="removed" value={summary.removed} />
        <Chip status="added" value={summary.added} />
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

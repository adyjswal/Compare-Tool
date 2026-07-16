/**
 * The navigation strip that appears once you engage a target — a summary chip
 * or the Find box. It shows *what* you're stepping through (a colour-coded
 * label), *where* you are (position / total), and gives first / prev / next /
 * last controls, so direction and position are always obvious.
 */

/** Colour keyed to the diff category, or the Find accent for matches. */
export type NavTone = "unchanged" | "added" | "removed" | "changed" | "find";

interface NavBarProps {
  label: string;
  tone: NavTone;
  /** 0-based current position, or -1 before the first jump. */
  pos: number;
  total: number;
  onGo: (dir: "first" | "prev" | "next" | "last") => void;
  /** Dismiss the navigation bar (back to normal). */
  onClose: () => void;
}

export function NavBar({ label, tone, pos, total, onGo, onClose }: NavBarProps) {
  const empty = total === 0;
  const position = empty ? "0" : `${pos >= 0 ? pos + 1 : "–"} / ${total.toLocaleString()}`;

  return (
    <div className={`navbar navbar-${tone}`}>
      <span className="navbar-chip">{label}</span>
      <span className="navbar-pos">{position}</span>
      <div className="navbar-steps" role="group" aria-label={`Navigate ${label}`}>
        <NavStep title="First" disabled={empty} onClick={() => onGo("first")} icon={<FirstIcon />} />
        <NavStep title="Previous" disabled={empty} onClick={() => onGo("prev")} icon={<PrevIcon />} />
        <NavStep title="Next" disabled={empty} onClick={() => onGo("next")} icon={<NextIcon />} />
        <NavStep title="Last" disabled={empty} onClick={() => onGo("last")} icon={<LastIcon />} />
      </div>
      <button
        type="button"
        className="navbar-close"
        title="Close (Esc)"
        aria-label="Close navigation"
        onClick={onClose}
      >
        <CloseIcon />
      </button>
    </div>
  );
}

function NavStep({
  title,
  disabled,
  onClick,
  icon,
}: {
  title: string;
  disabled: boolean;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button type="button" className="navbar-step" title={title} aria-label={title} disabled={disabled} onClick={onClick}>
      {icon}
    </button>
  );
}

/* Crisp inline SVGs (stroke = currentColor) so they render identically in any
   theme and at any zoom — no font-glyph inconsistency. Up = previous, down =
   next; a bar marks first/last. */
const SVG = (props: { children: React.ReactNode }) => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {props.children}
  </svg>
);
const PrevIcon = () => (
  <SVG>
    <path d="M4 10l4-4 4 4" />
  </SVG>
);
const NextIcon = () => (
  <SVG>
    <path d="M4 6l4 4 4-4" />
  </SVG>
);
const FirstIcon = () => (
  <SVG>
    <path d="M4 3.5h8" />
    <path d="M4 11l4-4 4 4" />
  </SVG>
);
const LastIcon = () => (
  <SVG>
    <path d="M4 5l4 4 4-4" />
    <path d="M4 12.5h8" />
  </SVG>
);
const CloseIcon = () => (
  <SVG>
    <path d="M4 4l8 8M12 4l-8 8" />
  </SVG>
);

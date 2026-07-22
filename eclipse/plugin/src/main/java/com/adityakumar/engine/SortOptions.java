package com.adityakumar.engine;

public final class SortOptions {
    public enum Mode { ALPHABETICAL, NUMERIC }
    public enum Direction { ASC, DESC }

    public final Mode mode;
    public final Direction direction;
    public final boolean caseInsensitive;
    public final boolean trim;
    public final ColumnSpec column;   // may be null → sort whole line

    public SortOptions() { this(Mode.ALPHABETICAL, Direction.ASC, false, true, null); }

    public SortOptions(Mode mode, Direction direction, boolean caseInsensitive, boolean trim, ColumnSpec column) {
        this.mode = mode; this.direction = direction;
        this.caseInsensitive = caseInsensitive; this.trim = trim; this.column = column;
    }
}

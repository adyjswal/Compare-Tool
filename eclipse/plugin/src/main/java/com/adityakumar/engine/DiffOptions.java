package com.adityakumar.engine;

public final class DiffOptions {
    public final String mode;           // "positional" | "set"
    public final ColumnSpec key;        // null → whole-line compare
    public final boolean trim;
    public final boolean caseInsensitive;
    public final boolean pairChanged;   // positional mode: pair similar removed+added as `changed`

    public DiffOptions() { this("positional", null, true, false, true); }

    /** Backward-compatible 4-arg form; pairChanged defaults to true. */
    public DiffOptions(String mode, ColumnSpec key, boolean trim, boolean caseInsensitive) {
        this(mode, key, trim, caseInsensitive, true);
    }

    public DiffOptions(String mode, ColumnSpec key, boolean trim, boolean caseInsensitive, boolean pairChanged) {
        this.mode = mode; this.key = key; this.trim = trim;
        this.caseInsensitive = caseInsensitive; this.pairChanged = pairChanged;
    }
}

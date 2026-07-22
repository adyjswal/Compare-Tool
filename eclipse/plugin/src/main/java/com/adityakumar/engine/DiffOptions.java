package com.adityakumar.engine;

public final class DiffOptions {
    public final String mode;           // "positional" | "set"
    public final ColumnSpec key;        // null → whole-line compare
    public final boolean trim;
    public final boolean caseInsensitive;

    public DiffOptions() { this("positional", null, true, false); }

    public DiffOptions(String mode, ColumnSpec key, boolean trim, boolean caseInsensitive) {
        this.mode = mode; this.key = key; this.trim = trim; this.caseInsensitive = caseInsensitive;
    }
}

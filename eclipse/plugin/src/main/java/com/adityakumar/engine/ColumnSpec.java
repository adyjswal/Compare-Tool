package com.adityakumar.engine;

public record ColumnSpec(String delimiter, int index) {
    /** @param delimiter field separator, e.g. "," or "\t"
     *  @param index 1-based column number */
    public ColumnSpec { if (index < 1) throw new IllegalArgumentException("index must be >= 1"); }
}

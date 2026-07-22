package com.adityakumar.engine;

public record DiffRow(DiffStatus status, String left, String right) {
    /** Convenience — left may be null for ADDED rows, right null for REMOVED. */
}

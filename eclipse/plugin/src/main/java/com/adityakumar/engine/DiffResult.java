package com.adityakumar.engine;

import java.util.List;

public record DiffResult(List<DiffRow> rows, DiffSummary summary) {}

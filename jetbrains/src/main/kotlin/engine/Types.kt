package com.adityakumar.engine

enum class DiffStatus { UNCHANGED, ADDED, REMOVED, CHANGED }
enum class SortMode { ALPHABETICAL, NUMERIC }
enum class SortDirection { ASC, DESC }

data class ColumnSpec(val delimiter: String = ",", val index: Int = 1)

data class SortOptions(
    val mode: SortMode = SortMode.ALPHABETICAL,
    val direction: SortDirection = SortDirection.ASC,
    val caseInsensitive: Boolean = false,
    val trim: Boolean = true,
    val column: ColumnSpec? = null
)

data class DiffOptions(
    val mode: String = "positional",   // "positional" | "set"
    val key: ColumnSpec? = null,
    val trim: Boolean = true,
    val caseInsensitive: Boolean = false,
    val pairChanged: Boolean = true
)

data class DiffRow(
    val status: DiffStatus,
    val left: String? = null,
    val right: String? = null
)

data class DiffSummary(
    val unchanged: Int,
    val added: Int,
    val removed: Int,
    val changed: Int,
    val total: Int
)

data class DiffResult(val rows: List<DiffRow>, val summary: DiffSummary)

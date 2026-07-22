package com.adityakumar.plugin

import com.adityakumar.engine.ColumnSpec
import com.adityakumar.engine.DiffOptions
import com.adityakumar.engine.DiffResult
import com.adityakumar.engine.DiffRow
import com.adityakumar.engine.DiffStatus
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.ComboBox
import com.intellij.ui.JBColor
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTextField
import com.intellij.ui.table.JBTable
import java.awt.BorderLayout
import java.awt.Color
import java.awt.Component
import java.awt.FlowLayout
import javax.swing.JButton
import javax.swing.JCheckBox
import javax.swing.JPanel
import javax.swing.JTable
import javax.swing.SwingConstants
import javax.swing.table.AbstractTableModel
import javax.swing.table.DefaultTableCellRenderer

/**
 * Side-by-side diff viewer panel.
 *
 * Virtualization is provided by JBTable: Swing renders only the cells that are
 * currently visible in the viewport — the TableModel reads rows directly from the
 * engine's result List<DiffRow> without copying any strings into a secondary
 * structure, so even a 1M-row result stays cheap at any scroll position.
 *
 * Layout:
 *   NORTH  — toolbar (mode, key-column fields, case-insensitive, recompute)
 *   CENTER — JBScrollPane(JBTable)  — two-column left/right diff with row coloring
 *   SOUTH  — status/summary label
 */
class DiffPanel(private val project: Project) : JPanel(BorderLayout()) {

    // ── stored paths for recompute ─────────────────────────────────────
    private var leftPath: String? = null
    private var rightPath: String? = null

    // ── toolbar controls ───────────────────────────────────────────────
    private val modeCombo = ComboBox<String>(arrayOf("Positional", "Set", "Key Column"))
    private val delimiterField = JBTextField(",", 5)
    private val keyColField = JBTextField("1", 4)
    private val caseCheck = JCheckBox("Case insensitive")
    private val recomputeButton = JButton("Recompute")
    private val delimiterLabel = JBLabel(" Delimiter:")
    private val keyColLabel = JBLabel(" Column #:")

    // ── status / summary bar ───────────────────────────────────────────
    private val statusLabel = JBLabel(
        "Use Tools → Large File Compare to start", SwingConstants.LEFT
    )

    // ── diff table (virtualized via JBTable) ───────────────────────────
    private val tableModel = DiffTableModel()
    private val table = JBTable(tableModel)

    init {
        // Wire toolbar events
        modeCombo.addActionListener { updateKeyFieldVisibility() }
        recomputeButton.addActionListener {
            if (leftPath != null && rightPath != null) runCompute()
        }

        // Configure table
        table.setDefaultRenderer(Any::class.java, DiffCellRenderer())
        table.autoResizeMode = JTable.AUTO_RESIZE_OFF
        table.columnModel.getColumn(0).preferredWidth = 600
        table.columnModel.getColumn(1).preferredWidth = 600
        table.rowHeight = 18
        table.fillsViewportHeight = true
        // Show grid lines so row boundaries are clear
        table.setShowGrid(true)
        table.gridColor = JBColor(Color(0xDDDDDD), Color(0x444444))

        // Build toolbar panel
        val toolbar = JPanel(FlowLayout(FlowLayout.LEFT, 4, 4))
        toolbar.add(JBLabel("Mode:"))
        toolbar.add(modeCombo)
        toolbar.add(delimiterLabel)
        toolbar.add(delimiterField)
        toolbar.add(keyColLabel)
        toolbar.add(keyColField)
        toolbar.add(caseCheck)
        toolbar.add(recomputeButton)

        // Status panel at bottom with small padding
        val statusPanel = JPanel(BorderLayout())
        statusPanel.add(statusLabel, BorderLayout.WEST)

        add(toolbar, BorderLayout.NORTH)
        add(JBScrollPane(table), BorderLayout.CENTER)
        add(statusPanel, BorderLayout.SOUTH)

        updateKeyFieldVisibility()
    }

    // ── public API called by CompareAction ─────────────────────────────

    /** Begin a new comparison. Reads options from the toolbar, runs in a background thread. */
    fun startComparison(left: String, right: String) {
        leftPath = left
        rightPath = right
        runCompute()
    }

    fun displayError(message: String) {
        statusLabel.text = "Error: $message"
        tableModel.setRows(emptyList())
        revalidate(); repaint()
    }

    fun displayPlaceholder() {
        statusLabel.text = "Use Tools → Large File Compare to start"
        tableModel.setRows(emptyList())
        revalidate(); repaint()
    }

    // ── private helpers ────────────────────────────────────────────────

    private fun updateKeyFieldVisibility() {
        val keyMode = modeCombo.selectedIndex == 2
        delimiterLabel.isVisible = keyMode
        delimiterField.isVisible = keyMode
        keyColLabel.isVisible = keyMode
        keyColField.isVisible = keyMode
    }

    private fun currentOptions(): DiffOptions {
        val ci = caseCheck.isSelected
        return when (modeCombo.selectedIndex) {
            1 -> DiffOptions(mode = "set", caseInsensitive = ci)
            2 -> {
                val delim = delimiterField.text.ifBlank { "," }
                val col = keyColField.text.trim().toIntOrNull()?.coerceAtLeast(1) ?: 1
                DiffOptions(
                    mode = "key",
                    key = ColumnSpec(delimiter = delim, index = col),
                    caseInsensitive = ci
                )
            }
            else -> DiffOptions(mode = "positional", caseInsensitive = ci)
        }
    }

    private fun runCompute() {
        val left = leftPath ?: return
        val right = rightPath ?: return
        statusLabel.text = "Comparing…"
        tableModel.setRows(emptyList())
        DiffBackgroundTask(
            project, left, right, currentOptions(),
            onResult = { result -> onResult(result) },
            onError  = { msg    -> displayError(msg) }
        ).queue()
    }

    private fun onResult(result: DiffResult) {
        tableModel.setRows(result.rows)
        val s = result.summary
        statusLabel.text =
            "Unchanged: ${s.unchanged}   Added: ${s.added}   " +
            "Removed: ${s.removed}   Changed: ${s.changed}   Total: ${s.total}"
        revalidate(); repaint()
    }

    // ── TableModel — reads DiffRow list directly, no copy ──────────────

    private class DiffTableModel : AbstractTableModel() {
        private var rows: List<DiffRow> = emptyList()

        /** Must be called on the EDT. Replaces the full row set and fires a full refresh. */
        fun setRows(newRows: List<DiffRow>) {
            rows = newRows
            fireTableDataChanged()
        }

        fun statusAt(row: Int): DiffStatus = rows[row].status

        override fun getRowCount(): Int = rows.size
        override fun getColumnCount(): Int = 2
        override fun getColumnName(col: Int): String = if (col == 0) "Left" else "Right"
        override fun getValueAt(row: Int, col: Int): Any =
            if (col == 0) rows[row].left ?: "" else rows[row].right ?: ""
    }

    // ── CellRenderer — colors rows by diff status ──────────────────────

    private inner class DiffCellRenderer : DefaultTableCellRenderer() {
        // Palette: matches the VS Code webview palette (light / dark)
        private val colorAdded     = JBColor(Color(0xDCF9DC), Color(0x1E3A1E))
        private val colorRemoved   = JBColor(Color(0xFFDDDD), Color(0x3A1E1E))
        private val colorChanged   = JBColor(Color(0xFFF3C4), Color(0x3A3200))
        private val colorUnchanged = JBColor(Color(0xFFFFFF), Color(0x2B2B2B))

        override fun getTableCellRendererComponent(
            table: JTable, value: Any?, isSelected: Boolean,
            hasFocus: Boolean, row: Int, column: Int
        ): Component {
            val c = super.getTableCellRendererComponent(
                table, value, isSelected, hasFocus, row, column
            )
            if (!isSelected) {
                c.background = when (tableModel.statusAt(row)) {
                    DiffStatus.ADDED     -> colorAdded
                    DiffStatus.REMOVED   -> colorRemoved
                    DiffStatus.CHANGED   -> colorChanged
                    DiffStatus.UNCHANGED -> colorUnchanged
                }
            }
            return c
        }
    }
}

package com.adityakumar.plugin

import com.adityakumar.engine.ColumnSpec
import com.adityakumar.engine.DiffOptions
import com.adityakumar.engine.DiffResult
import com.adityakumar.engine.DiffRow
import com.adityakumar.engine.DiffStatus
import com.adityakumar.engine.SortDirection
import com.adityakumar.engine.SortMode
import com.adityakumar.engine.SortOptions
import com.intellij.openapi.fileChooser.FileSaverDescriptor
import com.intellij.openapi.fileChooser.FileChooserFactory
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.ComboBox
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.ui.JBColor
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTextField
import com.intellij.ui.table.JBTable
import java.awt.BorderLayout
import java.awt.Color
import java.awt.Component
import java.awt.FlowLayout
import java.awt.GridLayout
import java.awt.event.ActionEvent
import java.awt.event.InputEvent
import java.awt.event.KeyAdapter
import java.awt.event.KeyEvent
import java.io.File
import java.util.concurrent.ExecutionException
import javax.swing.AbstractAction
import javax.swing.JButton
import javax.swing.JCheckBox
import javax.swing.JComponent
import javax.swing.JOptionPane
import javax.swing.JPanel
import javax.swing.JTable
import javax.swing.JToggleButton
import javax.swing.KeyStroke
import javax.swing.SwingConstants
import javax.swing.SwingWorker
import javax.swing.event.DocumentEvent
import javax.swing.event.DocumentListener
import javax.swing.table.AbstractTableModel
import javax.swing.table.DefaultTableCellRenderer

/**
 * Side-by-side diff viewer panel.
 *
 * Virtualization is provided by JBTable: Swing renders only the cells visible
 * in the viewport — the TableModel reads rows directly from the engine's
 * result List<DiffRow> without copying strings into a secondary structure.
 *
 * Layout:
 *   NORTH  — two-row header
 *              Row 1 (options): mode combo, sort combo, key-column fields,
 *                               case-insensitive, ignore-whitespace,
 *                               show-edits-as-changed, Recompute
 *              Row 2 (find):    search field, Aa (case) toggle, .* (regex) toggle,
 *                               ◀ Prev / ▶ Next buttons, match-count label, Export
 *   CENTER — JBScrollPane(JBTable) — two-column left/right diff with row coloring
 *   SOUTH  — status/summary label
 */
class DiffPanel(private val project: Project) : JPanel(BorderLayout()) {

    // ── stored paths for recompute ─────────────────────────────────────
    private var leftPath: String? = null
    private var rightPath: String? = null

    // ── options toolbar (row 1) ────────────────────────────────────────
    private val modeCombo    = ComboBox<String>(arrayOf("Positional", "Set", "Key Column"))
    private val sortLabel    = JBLabel(" Sort:")
    private val sortCombo    = ComboBox<String>(arrayOf(
        "Original", "Alphabetical ↑", "Alphabetical ↓", "Numeric ↑", "Numeric ↓"
    ))
    private val delimiterField  = JBTextField(",", 5)
    private val keyColField     = JBTextField("1", 4)
    private val delimiterLabel  = JBLabel(" Delimiter:")
    private val keyColLabel     = JBLabel(" Column #:")
    private val caseCheck       = JCheckBox("Case insensitive")
    private val trimCheck       = JCheckBox("Ignore whitespace").apply { isSelected = true }
    private val pairChangedCheck = JCheckBox("Show edits as changed").apply { isSelected = true }
    private val recomputeButton = JButton("Recompute")

    // ── find bar (row 2) ───────────────────────────────────────────────
    private val findField      = JBTextField(22).apply { emptyText.text = "Find in both files…" }
    private val findCaseButton = JToggleButton("Aa").apply { toolTipText = "Match case" }
    private val findRegexButton = JToggleButton(".*").apply { toolTipText = "Use regular expression" }
    private val findPrevButton = JButton("◀").apply {
        toolTipText = "Previous match (Shift+F3)"; isEnabled = false
    }
    private val findNextButton = JButton("▶").apply {
        toolTipText = "Next match (F3)"; isEnabled = false
    }
    private val findCountLabel = JBLabel("")
    private val findErrorLabel = JBLabel("⚠ Invalid regex").apply {
        foreground = JBColor(Color(0xCC0000), Color(0xFF6666)); isVisible = false
    }
    private val exportButton   = JButton("Export").apply {
        toolTipText = "Export diff to CSV or plain text"
    }

    // ── find state ─────────────────────────────────────────────────────
    private var matchIndices: List<Int> = emptyList()
    private var currentMatchIdx = -1
    private var findWorker: SwingWorker<FindScanner.FindResult, Unit>? = null

    // ── status / summary bar ───────────────────────────────────────────
    private val statusLabel = JBLabel(
        "Use Tools → Large File Compare to start", SwingConstants.LEFT
    )

    // ── diff table (virtualized via JBTable) ───────────────────────────
    private val tableModel = DiffTableModel()
    private val table      = JBTable(tableModel)

    init {
        // ── toolbar event wiring ───────────────────────────────────────
        modeCombo.addActionListener   { updateToolbarState() }
        sortCombo.addActionListener   { updateToolbarState() }
        recomputeButton.addActionListener {
            if (leftPath != null && rightPath != null) runCompute()
        }

        // ── find bar event wiring ──────────────────────────────────────
        findField.document.addDocumentListener(object : DocumentListener {
            override fun insertUpdate(e: DocumentEvent) = runFind()
            override fun removeUpdate(e: DocumentEvent) = runFind()
            override fun changedUpdate(e: DocumentEvent) = Unit  // attribute changes — ignore
        })
        findCaseButton.addActionListener  { runFind() }
        findRegexButton.addActionListener { runFind() }
        findPrevButton.addActionListener  { navigateFind(-1) }
        findNextButton.addActionListener  { navigateFind(1) }
        // Enter = next, Shift+Enter = previous inside the find field
        findField.addKeyListener(object : KeyAdapter() {
            override fun keyPressed(e: KeyEvent) {
                when {
                    e.keyCode == KeyEvent.VK_ENTER && !e.isShiftDown -> { navigateFind(1);  e.consume() }
                    e.keyCode == KeyEvent.VK_ENTER &&  e.isShiftDown -> { navigateFind(-1); e.consume() }
                }
            }
        })
        exportButton.addActionListener { runExport() }

        // ── table configuration ────────────────────────────────────────
        table.setDefaultRenderer(Any::class.java, DiffCellRenderer())
        table.autoResizeMode = JTable.AUTO_RESIZE_OFF
        table.columnModel.getColumn(0).preferredWidth = 600
        table.columnModel.getColumn(1).preferredWidth = 600
        table.rowHeight = 18
        table.fillsViewportHeight = true
        table.setShowGrid(true)
        table.gridColor = JBColor(Color(0xDDDDDD), Color(0x444444))

        // Ctrl/Cmd+F → focus find field; F3/Shift+F3 → navigate
        registerKeyboardShortcuts()

        // ── layout ─────────────────────────────────────────────────────
        val optionsBar = JPanel(FlowLayout(FlowLayout.LEFT, 4, 4))
        optionsBar.add(JBLabel("Mode:"))
        optionsBar.add(modeCombo)
        optionsBar.add(sortLabel)
        optionsBar.add(sortCombo)
        optionsBar.add(delimiterLabel)
        optionsBar.add(delimiterField)
        optionsBar.add(keyColLabel)
        optionsBar.add(keyColField)
        optionsBar.add(caseCheck)
        optionsBar.add(trimCheck)
        optionsBar.add(pairChangedCheck)
        optionsBar.add(recomputeButton)

        val findBar = JPanel(FlowLayout(FlowLayout.LEFT, 4, 2))
        findBar.add(JBLabel("Find:"))
        findBar.add(findField)
        findBar.add(findCaseButton)
        findBar.add(findRegexButton)
        findBar.add(findPrevButton)
        findBar.add(findNextButton)
        findBar.add(findCountLabel)
        findBar.add(findErrorLabel)
        findBar.add(JBLabel("   "))   // spacer
        findBar.add(exportButton)

        val topPanel = JPanel(BorderLayout())
        topPanel.add(optionsBar, BorderLayout.NORTH)
        topPanel.add(findBar,    BorderLayout.SOUTH)

        val statusPanel = JPanel(BorderLayout())
        statusPanel.add(statusLabel, BorderLayout.WEST)

        add(topPanel,           BorderLayout.NORTH)
        add(JBScrollPane(table), BorderLayout.CENTER)
        add(statusPanel,        BorderLayout.SOUTH)

        updateToolbarState()
    }

    // ── public API called by CompareAction ─────────────────────────────

    /** Begin a new comparison. Reads options from the toolbar, runs in background. */
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

    // ── private: toolbar state management ─────────────────────────────

    private fun updateToolbarState() {
        val keyMode = modeCombo.selectedIndex == 2
        val hasSort = sortCombo.selectedIndex != 0

        // Key-column fields visible only in key mode
        delimiterLabel.isVisible = keyMode
        delimiterField.isVisible = keyMode
        keyColLabel.isVisible    = keyMode
        keyColField.isVisible    = keyMode

        // Sort disabled when key mode is active (key > sort > positional precedence)
        sortLabel.isEnabled  = !keyMode
        sortCombo.isEnabled  = !keyMode
        if (keyMode) sortCombo.selectedIndex = 0

        // pairChanged only relevant in positional mode with no sort applied
        val isPositional = modeCombo.selectedIndex == 0
        pairChangedCheck.isEnabled = isPositional && !hasSort && !keyMode
    }

    // ── private: diff options ──────────────────────────────────────────

    /**
     * Build the current [DiffOptions] and [SortOptions] from the toolbar controls.
     *
     * [SortOptions] is null when the user chose "Original" or when key mode is active
     * (key takes precedence and sort is meaningless in that context).
     *
     * Sort mirror of VS Code's toSortOptions helper in App.tsx:
     *   alpha uses caseInsensitive=true, trim=true
     *   numeric uses caseInsensitive=false, trim=true
     */
    private fun currentOptions(): Pair<DiffOptions, SortOptions?> {
        val ci          = caseCheck.isSelected
        val trim        = trimCheck.isSelected
        val pairChanged = pairChangedCheck.isEnabled && pairChangedCheck.isSelected

        val sortOpt: SortOptions? = if (modeCombo.selectedIndex == 2) null else
            when (sortCombo.selectedIndex) {
                1 -> SortOptions(SortMode.ALPHABETICAL, SortDirection.ASC,  caseInsensitive = true,  trim = true)
                2 -> SortOptions(SortMode.ALPHABETICAL, SortDirection.DESC, caseInsensitive = true,  trim = true)
                3 -> SortOptions(SortMode.NUMERIC,      SortDirection.ASC,  caseInsensitive = false, trim = true)
                4 -> SortOptions(SortMode.NUMERIC,      SortDirection.DESC, caseInsensitive = false, trim = true)
                else -> null
            }

        val diffOpts = when (modeCombo.selectedIndex) {
            1 -> DiffOptions(mode = "set", caseInsensitive = ci, trim = trim, pairChanged = pairChanged)
            2 -> {
                val delim = delimiterField.text.ifBlank { "," }
                val col   = keyColField.text.trim().toIntOrNull()?.coerceAtLeast(1) ?: 1
                DiffOptions(
                    mode           = "key",
                    key            = ColumnSpec(delimiter = delim, index = col),
                    caseInsensitive = ci,
                    trim           = trim,
                    pairChanged    = pairChanged
                )
            }
            else -> DiffOptions(mode = "positional", caseInsensitive = ci, trim = trim, pairChanged = pairChanged)
        }

        return Pair(diffOpts, sortOpt)
    }

    private fun runCompute() {
        val left  = leftPath  ?: return
        val right = rightPath ?: return
        statusLabel.text = "Comparing…"
        tableModel.setRows(emptyList())
        matchIndices    = emptyList()
        currentMatchIdx = -1
        updateFindLabel()
        val (diffOpts, sortOpt) = currentOptions()
        DiffBackgroundTask(
            project, left, right, diffOpts, sortOpt,
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
        // Re-run find against the new data if a query is already typed
        if (findField.text.isNotEmpty()) runFind()
    }

    // ── private: find ──────────────────────────────────────────────────

    /**
     * (Re-)scan the current rows with the text in the find field. Cancels any
     * in-flight scan first so rapid keystrokes don't pile up. The scan runs on
     * a SwingWorker background thread (via [FindScanner]) so 1M rows stay safe.
     */
    private fun runFind() {
        findWorker?.cancel(true)
        val query         = findField.text
        val caseSensitive = findCaseButton.isSelected
        val isRegex       = findRegexButton.isSelected
        val rows          = tableModel.getRows()

        if (query.isEmpty()) {
            matchIndices    = emptyList()
            currentMatchIdx = -1
            findErrorLabel.isVisible = false
            updateFindLabel()
            return
        }

        findWorker = object : SwingWorker<FindScanner.FindResult, Unit>() {
            override fun doInBackground() = FindScanner.scan(rows, query, caseSensitive, isRegex)
            override fun done() {
                if (isCancelled) return
                val result = try { get() } catch (_: ExecutionException) { return }
                    catch (_: InterruptedException) { return }
                matchIndices    = result.indices
                currentMatchIdx = if (matchIndices.isNotEmpty()) 0 else -1
                findErrorLabel.isVisible = result.regexError
                updateFindLabel()
                if (currentMatchIdx >= 0) scrollToMatch()
            }
        }.also { it.execute() }
    }

    private fun navigateFind(direction: Int) {
        if (matchIndices.isEmpty()) return
        currentMatchIdx = (currentMatchIdx + direction + matchIndices.size) % matchIndices.size
        updateFindLabel()
        scrollToMatch()
    }

    private fun scrollToMatch() {
        if (currentMatchIdx < 0 || matchIndices.isEmpty()) return
        val rowIndex = matchIndices[currentMatchIdx]
        table.clearSelection()
        table.setRowSelectionInterval(rowIndex, rowIndex)
        table.scrollRectToVisible(table.getCellRect(rowIndex, 0, true))
    }

    private fun updateFindLabel() {
        val total   = matchIndices.size
        val current = if (total > 0 && currentMatchIdx >= 0) currentMatchIdx + 1 else 0
        findCountLabel.text = when {
            findField.text.isEmpty() -> ""
            total == 0               -> "No matches"
            else                     -> "$current / $total"
        }
        findPrevButton.isEnabled = total > 0
        findNextButton.isEnabled = total > 0
    }

    // ── private: export ────────────────────────────────────────────────

    /**
     * Show a small format+scope dialog, open the platform's file-saver dialog,
     * then write the file on a background thread via [DiffExportTask].
     *
     * Formats and field encoding are exact ports of `writeDiffFile` / `csvField` /
     * `textBlock` from `extension/src/panel/diffPanel.ts`.
     */
    private fun runExport() {
        val rows = tableModel.getRows()
        if (rows.isEmpty()) {
            JOptionPane.showMessageDialog(
                this, "Nothing to export — run a comparison first.",
                "Export", JOptionPane.INFORMATION_MESSAGE
            )
            return
        }

        // ── step 1: ask for format and scope ──────────────────────────
        val formatCombo = ComboBox(arrayOf("CSV (.csv)", "Plain text (.txt)"))
        val scopeCombo  = ComboBox(arrayOf(
            "Changed rows only  (Added, Removed, Changed)",
            "All rows  (including Unchanged)"
        ))
        val dialogPanel = JPanel(GridLayout(2, 2, 8, 6))
        dialogPanel.add(JBLabel("Format:"))
        dialogPanel.add(formatCombo)
        dialogPanel.add(JBLabel("Scope:"))
        dialogPanel.add(scopeCombo)

        val choice = JOptionPane.showConfirmDialog(
            this, dialogPanel, "Export Diff",
            JOptionPane.OK_CANCEL_OPTION, JOptionPane.PLAIN_MESSAGE
        )
        if (choice != JOptionPane.OK_OPTION) return

        val isCSV       = formatCombo.selectedIndex == 0
        val changesOnly = scopeCombo.selectedIndex == 0
        val ext         = if (isCSV) "csv" else "txt"

        // ── step 2: pick a save location ─────────────────────────────
        val descriptor = FileSaverDescriptor(
            "Export Diff", "Choose where to save the diff file", ext
        )
        val saveDialog = FileChooserFactory.getInstance().createSaveFileDialog(descriptor, project)
        val baseDir = leftPath?.let { p ->
            val parent = File(p).parentFile
            if (parent != null && parent.exists())
                LocalFileSystem.getInstance().refreshAndFindFileByIoFile(parent)
            else null
        }
        val wrapper = saveDialog.save(baseDir, buildExportName(ext)) ?: return

        // ── step 3: write in background ───────────────────────────────
        DiffExportTask(project, rows, wrapper.file.absolutePath, isCSV, changesOnly).queue()
    }

    private fun buildExportName(ext: String): String {
        val l = leftPath?.let  { File(it).nameWithoutExtension } ?: "left"
        val r = rightPath?.let { File(it).nameWithoutExtension } ?: "right"
        return "$l-vs-$r.$ext"
    }

    // ── private: keyboard shortcuts ────────────────────────────────────

    private fun registerKeyboardShortcuts() {
        val im = table.getInputMap(JComponent.WHEN_ANCESTOR_OF_FOCUSED_COMPONENT)
        val am = table.actionMap

        // Ctrl+F / Cmd+F → focus the find field
        im.put(KeyStroke.getKeyStroke(KeyEvent.VK_F, InputEvent.CTRL_DOWN_MASK), "focusFind")
        im.put(KeyStroke.getKeyStroke(KeyEvent.VK_F, InputEvent.META_DOWN_MASK), "focusFind")
        am.put("focusFind", object : AbstractAction() {
            override fun actionPerformed(e: ActionEvent) { findField.requestFocusInWindow() }
        })

        // F3 / Shift+F3 → step through matches
        im.put(KeyStroke.getKeyStroke(KeyEvent.VK_F3, 0),                             "findNext")
        im.put(KeyStroke.getKeyStroke(KeyEvent.VK_F3, InputEvent.SHIFT_DOWN_MASK),    "findPrev")
        am.put("findNext", object : AbstractAction() {
            override fun actionPerformed(e: ActionEvent) { navigateFind(1) }
        })
        am.put("findPrev", object : AbstractAction() {
            override fun actionPerformed(e: ActionEvent) { navigateFind(-1) }
        })
    }

    // ── TableModel — reads DiffRow list directly, no copy ──────────────

    private class DiffTableModel : AbstractTableModel() {
        private var rows: List<DiffRow> = emptyList()

        /** Must be called on the EDT. Replaces the full row set and fires a full refresh. */
        fun setRows(newRows: List<DiffRow>) {
            rows = newRows
            fireTableDataChanged()
        }

        fun getRows(): List<DiffRow> = rows
        fun statusAt(row: Int): DiffStatus = rows[row].status

        override fun getRowCount(): Int    = rows.size
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

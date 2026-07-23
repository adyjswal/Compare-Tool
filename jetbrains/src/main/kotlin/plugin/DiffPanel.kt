package com.adityakumar.plugin

import com.adityakumar.engine.ColumnSpec
import com.adityakumar.engine.DiffOptions
import com.adityakumar.engine.DiffResult
import com.adityakumar.engine.DiffRow
import com.adityakumar.engine.DiffStatus
import com.adityakumar.engine.DisplayRowModel
import com.adityakumar.engine.DisplayRowModel.ViewMode
import com.adityakumar.engine.SortDirection
import com.adityakumar.engine.SortMode
import com.adityakumar.engine.SortOptions
import com.adityakumar.engine.WordDiff
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
import java.awt.Dimension
import java.awt.FlowLayout
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.GridLayout
import java.awt.RenderingHints
import java.awt.event.ActionEvent
import java.awt.event.InputEvent
import java.awt.event.KeyAdapter
import java.awt.event.KeyEvent
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import java.io.File
import java.util.concurrent.ExecutionException
import javax.swing.AbstractAction
import javax.swing.JButton
import javax.swing.JCheckBox
import javax.swing.JComponent
import javax.swing.JLabel
import javax.swing.JOptionPane
import javax.swing.JPanel
import javax.swing.JScrollBar
import javax.swing.JTable
import javax.swing.JToggleButton
import javax.swing.KeyStroke
import javax.swing.SwingConstants
import javax.swing.SwingWorker
import javax.swing.event.ChangeEvent
import javax.swing.event.ChangeListener
import javax.swing.event.DocumentEvent
import javax.swing.event.DocumentListener
import javax.swing.table.AbstractTableModel
import javax.swing.table.TableCellRenderer

/**
 * Side-by-side diff viewer panel.
 *
 * Virtualization is provided by JBTable: Swing renders only the cells visible
 * in the viewport — the TableModel reads rows directly from the engine's
 * result List<DiffRow> without copying strings into a secondary structure.
 *
 * New in this revision:
 *  - INLINE WORD-DIFF: CHANGED rows highlight the differing token span per side.
 *  - OVERVIEW RULER: a 14 px strip beside the table showing diffs as colored bands.
 *  - VIEW MODE TOGGLE: All / Changes Only / Collapsed (fold unchanged runs).
 *
 * Layout:
 *   NORTH  — two-row header
 *              Row 1 (options): mode combo, sort combo, key-column fields,
 *                               case-insensitive, ignore-whitespace,
 *                               show-edits-as-changed, view-mode toggle, Recompute
 *              Row 2 (find):    search field, Aa (case) toggle, .* (regex) toggle,
 *                               ◀ Prev / ▶ Next buttons, match-count label, Export
 *   CENTER — JPanel(BorderLayout):
 *              CENTER = JBScrollPane(JBTable)
 *              EAST   = OverviewRuler (14 px wide)
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
    private val viewModeCombo   = ComboBox<String>(arrayOf("All rows", "Changes only", "Collapsed"))
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
    private var matchIndices: List<Int> = emptyList()   // absolute row indices
    private var currentMatchIdx = -1
    private var findWorker: SwingWorker<FindScanner.FindResult, Unit>? = null

    // ── status / summary bar ───────────────────────────────────────────
    private val statusLabel = JBLabel(
        "Use Tools → Large File Compare to start", SwingConstants.LEFT
    )

    // ── diff table (virtualized via JBTable) ───────────────────────────
    private val tableModel = DiffTableModel()
    private val table      = JBTable(tableModel)

    // ── display-row model state ────────────────────────────────────────
    private var displayModel: DisplayRowModel.Model = DisplayRowModel.Model(
        count = 0, map = null, folds = emptyList(), absToDisplay = null, displayStatuses = null
    )
    private var expandedFolds: MutableSet<Int> = mutableSetOf()

    // ── overview ruler ─────────────────────────────────────────────────
    private val ruler = OverviewRuler()

    init {
        // ── toolbar event wiring ───────────────────────────────────────
        modeCombo.addActionListener   { updateToolbarState() }
        sortCombo.addActionListener   { updateToolbarState() }
        recomputeButton.addActionListener {
            if (leftPath != null && rightPath != null) runCompute()
        }

        // View-mode toggle → rebuild display model, keep find working
        viewModeCombo.addActionListener {
            expandedFolds.clear()
            rebuildDisplayModel()
        }

        // ── find bar event wiring ──────────────────────────────────────
        findField.document.addDocumentListener(object : DocumentListener {
            override fun insertUpdate(e: DocumentEvent) = runFind()
            override fun removeUpdate(e: DocumentEvent) = runFind()
            override fun changedUpdate(e: DocumentEvent) = Unit
        })
        findCaseButton.addActionListener  { runFind() }
        findRegexButton.addActionListener { runFind() }
        findPrevButton.addActionListener  { navigateFind(-1) }
        findNextButton.addActionListener  { navigateFind(1) }
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
        table.rowHeight = 20   // matches ROW_HEIGHT=20 in VS Code
        table.fillsViewportHeight = true
        table.setShowGrid(true)
        table.gridColor = JBColor(Color(0xDDDDDD), Color(0x444444))

        // Row selection → update ruler currentIndex
        table.selectionModel.addListSelectionListener { e ->
            if (!e.valueIsAdjusting) {
                val sel = table.selectedRow
                ruler.currentIndex = sel   // already in display space
                ruler.repaint()
            }
        }

        // Click on fold marker rows → expand that fold
        table.addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                val row = table.rowAtPoint(e.point)
                if (row < 0) return
                val fold = tableModel.foldAt(row)
                if (fold != null) expandFold(fold.runStart)
            }
        })

        // ── ruler wiring ───────────────────────────────────────────────
        ruler.preferredSize = Dimension(OverviewRuler.RULER_WIDTH, 0)
        ruler.onJump = { displayIdx ->
            if (displayIdx >= 0 && displayIdx < tableModel.rowCount) {
                table.clearSelection()
                table.setRowSelectionInterval(displayIdx, displayIdx)
                table.scrollRectToVisible(table.getCellRect(displayIdx, 0, true))
                ruler.currentIndex = displayIdx
                ruler.repaint()
            }
        }

        // Keyboard shortcuts
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
        optionsBar.add(JBLabel(" View:"))
        optionsBar.add(viewModeCombo)
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

        // Scroll pane with ruler beside it
        val scrollPane = JBScrollPane(table)

        // Track scroll position to keep ruler viewport box in sync
        val vbar: JScrollBar = scrollPane.verticalScrollBar
        vbar.model.addChangeListener(object : ChangeListener {
            override fun stateChanged(e: ChangeEvent) {
                val firstRow = vbar.value / table.rowHeight
                ruler.firstRow = firstRow
                ruler.repaint()
            }
        })

        val centerPanel = JPanel(BorderLayout())
        centerPanel.add(scrollPane, BorderLayout.CENTER)
        centerPanel.add(ruler,      BorderLayout.EAST)

        add(topPanel,     BorderLayout.NORTH)
        add(centerPanel,  BorderLayout.CENTER)
        add(statusPanel,  BorderLayout.SOUTH)

        updateToolbarState()
    }

    // ── public API called by CompareAction ─────────────────────────────

    fun startComparison(left: String, right: String) {
        leftPath = left
        rightPath = right
        runCompute()
    }

    fun displayError(message: String) {
        statusLabel.text = "Error: $message"
        tableModel.setRows(emptyList())
        rebuildDisplayModel()
        revalidate(); repaint()
    }

    fun displayPlaceholder() {
        statusLabel.text = "Use Tools → Large File Compare to start"
        tableModel.setRows(emptyList())
        rebuildDisplayModel()
        revalidate(); repaint()
    }

    // ── private: toolbar state management ─────────────────────────────

    private fun updateToolbarState() {
        val keyMode = modeCombo.selectedIndex == 2
        val hasSort = sortCombo.selectedIndex != 0

        delimiterLabel.isVisible = keyMode
        delimiterField.isVisible = keyMode
        keyColLabel.isVisible    = keyMode
        keyColField.isVisible    = keyMode

        sortLabel.isEnabled  = !keyMode
        sortCombo.isEnabled  = !keyMode
        if (keyMode) sortCombo.selectedIndex = 0

        val isPositional = modeCombo.selectedIndex == 0
        pairChangedCheck.isEnabled = isPositional && !hasSort && !keyMode
    }

    // ── private: diff options ──────────────────────────────────────────

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
        expandedFolds.clear()
        rebuildDisplayModel()
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
        expandedFolds.clear()
        rebuildDisplayModel()
        val s = result.summary
        statusLabel.text =
            "Unchanged: ${s.unchanged}   Added: ${s.added}   " +
            "Removed: ${s.removed}   Changed: ${s.changed}   Total: ${s.total}"
        revalidate(); repaint()
        if (findField.text.isNotEmpty()) runFind()
    }

    // ── private: display-row model ─────────────────────────────────────

    /**
     * Rebuild the display model from the current raw rows and view mode.
     * Called whenever rows, view mode, or expanded folds change.
     */
    private fun rebuildDisplayModel() {
        val rows = tableModel.getRawRows()
        val mode = when (viewModeCombo.selectedIndex) {
            1    -> ViewMode.CHANGES
            2    -> ViewMode.COLLAPSED
            else -> ViewMode.ALL
        }
        val statusBytes = ByteArray(rows.size) { i ->
            when (rows[i].status) {
                DiffStatus.UNCHANGED -> 0
                DiffStatus.ADDED     -> 1
                DiffStatus.REMOVED   -> 2
                DiffStatus.CHANGED   -> 3
            }
        }
        displayModel = DisplayRowModel.build(
            statuses = statusBytes,
            mode     = mode,
            context  = DisplayRowModel.CONTEXT_ROWS,
            expanded = expandedFolds.toSet()
        )

        // Update table row count via the model
        tableModel.setDisplayModel(displayModel)

        // Update ruler
        val rulerStatuses = displayModel.displayStatuses ?: statusBytes
        ruler.statuses = rulerStatuses
        ruler.firstRow = 0
        ruler.currentIndex = -1
        ruler.repaint()
    }

    /**
     * Expand a folded run. Called from the fold-marker renderer when clicked.
     */
    private fun expandFold(runStart: Int) {
        expandedFolds.add(runStart)
        rebuildDisplayModel()
        revalidate(); repaint()
    }

    // ── private: find ──────────────────────────────────────────────────

    /**
     * Find scans the raw rows (not display rows) so absolute indices are stable.
     * Navigation translates absolute → display via the model.
     */
    private fun runFind() {
        findWorker?.cancel(true)
        val query         = findField.text
        val caseSensitive = findCaseButton.isSelected
        val isRegex       = findRegexButton.isSelected
        val rows          = tableModel.getRawRows()

        if (query.isEmpty()) {
            matchIndices    = emptyList()
            currentMatchIdx = -1
            findErrorLabel.isVisible = false
            updateFindLabel()
            table.repaint()
            return
        }

        findWorker = object : SwingWorker<FindScanner.FindResult, Unit>() {
            override fun doInBackground() = FindScanner.scan(rows, query, caseSensitive, isRegex)
            override fun done() {
                if (isCancelled) return
                val result = try { get() } catch (_: ExecutionException) { return }
                    catch (_: InterruptedException) { return }
                // matchIndices are absolute row indices
                matchIndices    = result.indices
                currentMatchIdx = if (matchIndices.isNotEmpty()) 0 else -1
                findErrorLabel.isVisible = result.regexError
                updateFindLabel()
                if (currentMatchIdx >= 0) scrollToMatch()
                table.repaint()
            }
        }.also { it.execute() }
    }

    private fun navigateFind(direction: Int) {
        if (matchIndices.isEmpty()) return
        currentMatchIdx = (currentMatchIdx + direction + matchIndices.size) % matchIndices.size
        updateFindLabel()
        scrollToMatch()
    }

    /**
     * Scroll to the current find match. The match index is absolute; translate
     * to display space before scrolling.
     */
    private fun scrollToMatch() {
        if (currentMatchIdx < 0 || matchIndices.isEmpty()) return
        val absRow = matchIndices[currentMatchIdx]

        // Translate absolute → display
        val displayRow = with(DisplayRowModel) { displayModel.displayOf(absRow) }

        // Ensure the row is visible (it might be inside a fold in collapsed mode)
        val hiddenFold = with(DisplayRowModel) { displayModel.hiddenInFold(absRow) }
        if (hiddenFold != null) {
            expandFold(hiddenFold.runStart)
            // After rebuild, retry scroll
            scrollToMatch()
            return
        }

        table.clearSelection()
        if (displayRow >= 0 && displayRow < tableModel.rowCount) {
            table.setRowSelectionInterval(displayRow, displayRow)
            table.scrollRectToVisible(table.getCellRect(displayRow, 0, true))
        }
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

    private fun runExport() {
        val rows = tableModel.getRawRows()
        if (rows.isEmpty()) {
            JOptionPane.showMessageDialog(
                this, "Nothing to export — run a comparison first.",
                "Export", JOptionPane.INFORMATION_MESSAGE
            )
            return
        }

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

        im.put(KeyStroke.getKeyStroke(KeyEvent.VK_F, InputEvent.CTRL_DOWN_MASK), "focusFind")
        im.put(KeyStroke.getKeyStroke(KeyEvent.VK_F, InputEvent.META_DOWN_MASK), "focusFind")
        am.put("focusFind", object : AbstractAction() {
            override fun actionPerformed(e: ActionEvent) { findField.requestFocusInWindow() }
        })

        im.put(KeyStroke.getKeyStroke(KeyEvent.VK_F3, 0),                             "findNext")
        im.put(KeyStroke.getKeyStroke(KeyEvent.VK_F3, InputEvent.SHIFT_DOWN_MASK),    "findPrev")
        am.put("findNext", object : AbstractAction() {
            override fun actionPerformed(e: ActionEvent) { navigateFind(1) }
        })
        am.put("findPrev", object : AbstractAction() {
            override fun actionPerformed(e: ActionEvent) { navigateFind(-1) }
        })
    }

    // ── TableModel — display-aware, reads through DisplayRowModel ──────

    private inner class DiffTableModel : AbstractTableModel() {
        private var rawRows: List<DiffRow> = emptyList()
        private var model: DisplayRowModel.Model = DisplayRowModel.Model(
            count = 0, map = null, folds = emptyList(), absToDisplay = null, displayStatuses = null
        )

        fun setRows(newRows: List<DiffRow>) {
            rawRows = newRows
            fireTableDataChanged()
        }

        fun setDisplayModel(newModel: DisplayRowModel.Model) {
            model = newModel
            fireTableDataChanged()
        }

        fun getRawRows(): List<DiffRow> = rawRows

        /** Expose the display model map for use by inner renderer classes. */
        fun getMap(): IntArray? = model.map

        /** Expose the raw rows size for use by inner renderer classes. */
        fun getRawRowAt(absIdx: Int): DiffRow? =
            if (absIdx >= 0 && absIdx < rawRows.size) rawRows[absIdx] else null

        /**
         * Decode display index d into the underlying DiffRow (or null for folds).
         * Returns null when d maps to a fold marker.
         */
        private fun rowAt(d: Int): DiffRow? {
            val m = model.map
            val v = if (m != null) m[d] else d
            if (v < 0) return null           // fold marker
            return if (v < rawRows.size) rawRows[v] else null
        }

        /** Status at display index d (fold markers return UNCHANGED). */
        fun statusAtDisplay(d: Int): DiffStatus {
            return rowAt(d)?.status ?: DiffStatus.UNCHANGED
        }

        /**
         * Whether display row d is a fold marker.
         * If so, returns the Fold object; otherwise null.
         */
        fun foldAt(d: Int): DisplayRowModel.Fold? {
            val m = model.map ?: return null
            val v = m[d]
            if (v >= 0) return null
            val foldId = -1 - v
            return if (foldId < model.folds.size) model.folds[foldId] else null
        }

        override fun getRowCount(): Int    = model.count
        override fun getColumnCount(): Int = 2
        override fun getColumnName(col: Int): String = if (col == 0) "Left" else "Right"
        override fun getValueAt(row: Int, col: Int): Any {
            val dr = rowAt(row) ?: return ""   // fold markers render as empty
            return if (col == 0) dr.left ?: "" else dr.right ?: ""
        }
    }

    // ── CellRenderer — colors rows + inline word-diff highlighting ─────

    private inner class DiffCellRenderer : TableCellRenderer {
        // Row background palette (matches VS Code webview palette, light/dark)
        private val colorAdded     = JBColor(Color(0xDCF9DC), Color(0x1E3A1E))
        private val colorRemoved   = JBColor(Color(0xFFDDDD), Color(0x3A1E1E))
        private val colorChanged   = JBColor(Color(0xFFF3C4), Color(0x3A3200))
        private val colorUnchanged = JBColor(Color(0xFFFFFF), Color(0x2B2B2B))

        // Word-diff highlight colors: stronger shade on top of row tint
        // Matches rgba(248,81,73,0.40) over the removed row tint
        private val highlightRemoved = JBColor(Color(248, 81, 73, 102),  Color(248, 81, 73, 102))
        // Matches rgba(46,160,67,0.40) over the added row tint
        private val highlightAdded   = JBColor(Color(46, 160, 67, 102),  Color(46, 160, 67, 102))

        override fun getTableCellRendererComponent(
            table: JTable, value: Any?, isSelected: Boolean,
            hasFocus: Boolean, row: Int, column: Int
        ): Component {
            // Check for fold marker
            val fold = tableModel.foldAt(row)
            if (fold != null) {
                return FoldRowRenderer(fold, isSelected)
            }

            val status = tableModel.statusAtDisplay(row)
            val text   = (value as? String) ?: ""

            val bg = if (isSelected) table.selectionBackground else
                when (status) {
                    DiffStatus.ADDED     -> colorAdded
                    DiffStatus.REMOVED   -> colorRemoved
                    DiffStatus.CHANGED   -> colorChanged
                    DiffStatus.UNCHANGED -> colorUnchanged
                }

            // For CHANGED rows: compute inline word diff and use a custom renderer
            if (status == DiffStatus.CHANGED && !isSelected) {
                val absIdx = (tableModel.getMap()?.get(row) ?: row)
                val dr     = tableModel.getRawRowAt(absIdx)
                if (dr != null) {
                    val inline = WordDiff.computeInline(dr.left ?: "", dr.right ?: "")
                    if (inline != null) {
                        val span = if (column == 0) inline.left else inline.right
                        val hl   = if (column == 0) highlightRemoved else highlightAdded
                        return WordDiffCellPanel(text, span, bg, hl)
                    }
                }
            }

            // Plain label renderer
            val label = JLabel(text)
            label.isOpaque = true
            label.background = bg
            label.font = table.font
            label.horizontalAlignment = SwingConstants.LEFT
            label.border = javax.swing.BorderFactory.createEmptyBorder(0, 4, 0, 4)
            return label
        }
    }

    /**
     * A lightweight panel that paints row background + word-diff highlight span.
     * Used only for CHANGED rows where computeInline returns a non-null result.
     */
    private inner class WordDiffCellPanel(
        private val text: String,
        private val span: WordDiff.Span,
        private val rowBg: Color,
        private val hlColor: Color
    ) : JComponent() {

        init {
            isOpaque = true
            background = rowBg
        }

        override fun paintComponent(g: Graphics) {
            val g2 = g as Graphics2D
            g2.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING,
                RenderingHints.VALUE_TEXT_ANTIALIAS_ON)

            val w = width
            val h = height

            // Fill row background
            g2.color = rowBg
            g2.fillRect(0, 0, w, h)

            if (text.isEmpty()) return

            val fm    = g2.fontMetrics
            val textX = 4   // left padding (matches border in label renderer)
            val textY = (h - fm.height) / 2 + fm.ascent

            // If span is non-empty, paint the highlight rectangle
            if (span.start < span.end && span.end <= text.length) {
                val prefix  = text.substring(0, span.start)
                val spanStr = text.substring(span.start, span.end)
                val xStart  = textX + fm.stringWidth(prefix)
                val xEnd    = xStart + fm.stringWidth(spanStr)

                g2.color = hlColor
                g2.fillRect(xStart, 1, xEnd - xStart, h - 2)
            }

            // Draw text on top
            g2.color = foreground
            g2.font  = table.font
            g2.drawString(text, textX, textY)
        }
    }

    /**
     * Full-width renderer for a fold marker row.
     * Displays "⋯ N unchanged lines" as a centered, clickable-looking label.
     */
    private inner class FoldRowRenderer(
        private val fold: DisplayRowModel.Fold,
        private val selected: Boolean
    ) : JComponent() {

        private val colorFold   = JBColor(Color(0xEEEEEE), Color(0x333333))
        private val colorFoldFg = JBColor(Color(0x666666), Color(0xAAAAAA))

        init {
            isOpaque = true
            background = colorFold
            toolTipText = "Click to expand ${fold.count} unchanged lines"
        }

        override fun paintComponent(g: Graphics) {
            val g2 = g as Graphics2D
            g2.color = if (selected) table.selectionBackground else colorFold
            g2.fillRect(0, 0, width, height)

            val label = "⋯ ${fold.count} unchanged lines"
            val fm    = g2.fontMetrics
            val x     = (width  - fm.stringWidth(label)) / 2
            val y     = (height - fm.height) / 2 + fm.ascent

            g2.color = colorFoldFg
            g2.font  = table.font
            g2.drawString(label, x, y)
        }
    }
}

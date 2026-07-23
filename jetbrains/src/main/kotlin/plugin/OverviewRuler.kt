package com.adityakumar.plugin

import java.awt.Color
import java.awt.Dimension
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.RenderingHints
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.JComponent

/**
 * Overview Ruler — a narrow change-map painted beside the diff table.
 *
 * Faithfully ports the OverviewRuler React component from DiffList.tsx.
 *
 * Paints a 14 px wide strip showing where diffs are in the file:
 *   - Left  half (0..6):  red  — removed or changed rows
 *   - Right half (7..13): green — added or changed rows
 * A translucent grey box shows the current scroll position.
 * A 3 px full-width blue bar marks the currently selected row.
 * Clicking jumps to the proportional row.
 *
 * The component operates entirely in *display space*: feed it
 * model.displayStatuses (or the raw statuses for "all" mode).
 * Status byte encoding: 0=unchanged, 1=added, 2=removed, 3=changed.
 */
class OverviewRuler : JComponent() {

    // ── constants (match VS Code CSS/TS constants exactly) ─────────────────────
    companion object {
        const val RULER_WIDTH = 14
        const val RULER_HALF  = 7

        // rgba(248, 81, 73, 0.85) — removed / left side of changed
        private val RED   = Color(248, 81,  73,  217)
        // rgba(46, 160, 67, 0.85) — added / right side of changed
        private val GREEN = Color( 46, 160,  67,  217)
        // rgba(128, 128, 128, 0.22) — viewport box fill
        private val BOX_FILL   = Color(128, 128, 128,  56)
        // rgba(160, 160, 160, 0.55) — viewport box border
        private val BOX_BORDER = Color(160, 160, 160, 140)
        // #4daafc fallback — current-row marker
        private val MARKER_COLOR = Color(77, 170, 252, 255)
    }

    // ── model fields (set from outside on EDT) ─────────────────────────────────

    /** Per-display-row status bytes (0=unchanged, 1=added, 2=removed, 3=changed). */
    var statuses: ByteArray = ByteArray(0)
        set(value) { field = value; repaint() }

    /** Number of display rows (= statuses.size). */
    val total: Int get() = statuses.size

    /** Index of the first visible display row. */
    var firstRow: Int = 0
        set(value) { field = value; repaint() }

    /** Fixed row height in pixels (mirrors ROW_HEIGHT = 20 from DiffList.tsx). */
    var rowHeight: Int = 20
        set(value) { field = value; repaint() }

    /** Currently selected display row, or -1 for none. */
    var currentIndex: Int = -1
        set(value) { field = value; repaint() }

    /** Called when the user clicks the ruler with the target display row index. */
    var onJump: (Int) -> Unit = {}

    // ── preferred size ─────────────────────────────────────────────────────────

    override fun getPreferredSize(): Dimension =
        Dimension(RULER_WIDTH, Integer.MAX_VALUE / 2)

    override fun getMinimumSize(): Dimension = Dimension(RULER_WIDTH, 0)

    // ── click handler ──────────────────────────────────────────────────────────

    init {
        addMouseListener(object : MouseAdapter() {
            override fun mousePressed(e: MouseEvent) {
                val h = height
                if (h <= 0 || total <= 0) return
                val fraction = e.y.toDouble() / h
                val index = minOf(total - 1, maxOf(0, (fraction * total).toInt()))
                onJump(index)
            }
        })
    }

    // ── paint ──────────────────────────────────────────────────────────────────

    override fun paintComponent(g: Graphics) {
        super.paintComponent(g)
        val g2 = g as Graphics2D
        g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_OFF)

        val pixels = height
        if (total <= 0 || pixels <= 0) return

        // 1. Build bucket arrays (O(total) time, O(pixels) space)
        val leftBand  = BooleanArray(pixels)
        val rightBand = BooleanArray(pixels)

        for (i in 0 until total) {
            val s = statuses[i].toInt() and 0xFF
            if (s == 0) continue
            val y = ((i + 0.5) / total * pixels).toInt()
                .coerceIn(0, pixels - 1)
            if (s == 2 || s == 3) leftBand[y]  = true
            if (s == 1 || s == 3) rightBand[y] = true
        }

        // 2. Paint bands (2 px tall per band — matches VS Code fillRect height=2)
        for (y in 0 until pixels) {
            if (leftBand[y]) {
                g2.color = RED
                g2.fillRect(0, y, RULER_HALF, 2)
            }
            if (rightBand[y]) {
                g2.color = GREEN
                g2.fillRect(RULER_HALF, y, RULER_WIDTH - RULER_HALF, 2)
            }
        }

        // 3. Viewport box
        val visibleRows = pixels.toDouble() / rowHeight
        val rawY0 = maxOf(0.0, (firstRow.toDouble() / total) * pixels)
        val rawY1 = minOf(pixels.toDouble(), ((firstRow + visibleRows) / total) * pixels)
        val boxH = maxOf(2, (rawY1 - rawY0).toInt())
        val y0   = maxOf(0.0, minOf(rawY0, pixels - boxH.toDouble())).toInt()

        g2.color = BOX_FILL
        g2.fillRect(0, y0, RULER_WIDTH, boxH)
        g2.color = BOX_BORDER
        g2.drawRect(0, y0, RULER_WIDTH - 1, boxH - 1)

        // 4. Current-row marker (3 px, full width)
        if (currentIndex >= 0) {
            val y = ((currentIndex + 0.5) / total * pixels).toInt()
                .coerceIn(0, pixels - 1)
            g2.color = MARKER_COLOR
            g2.fillRect(0, maxOf(0, y - 1), RULER_WIDTH, 3)
        }
    }
}

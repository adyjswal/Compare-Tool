package com.adityakumar.plugin

import com.adityakumar.engine.DiffRow
import com.adityakumar.engine.DiffStatus
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.Task
import com.intellij.openapi.project.Project
import java.io.BufferedWriter
import java.io.File
import java.io.FileWriter
import javax.swing.JOptionPane

/**
 * Background task that writes a diff result to a file in CSV or plain-text format.
 *
 * Formats are direct ports of `writeDiffFile` / `csvField` / `textBlock` from
 * `extension/src/panel/diffPanel.ts`. Line numbers are computed the same way:
 * every row is counted so the numbers match the source files even when
 * [changesOnly] is true.
 */
class DiffExportTask(
    project: Project,
    private val rows: List<DiffRow>,
    private val targetPath: String,
    private val isCSV: Boolean,
    private val changesOnly: Boolean
) : Task.Backgroundable(project, "Large File Compare: exporting…", false) {

    override fun run(indicator: ProgressIndicator) {
        indicator.isIndeterminate = true
        indicator.text = "Writing ${File(targetPath).name}…"
        try {
            BufferedWriter(FileWriter(targetPath)).use { writer ->
                if (isCSV) writer.write("Status,Left #,Right #,Left,Right\r\n")
                var leftNo = 0
                var rightNo = 0
                for (row in rows) {
                    val s = row.status
                    // Count line numbers over EVERY row so they match the source files,
                    // even when unchanged rows are filtered from the output below.
                    val ln = if (s == DiffStatus.UNCHANGED || s == DiffStatus.REMOVED || s == DiffStatus.CHANGED) ++leftNo else 0
                    val rn = if (s == DiffStatus.UNCHANGED || s == DiffStatus.ADDED || s == DiffStatus.CHANGED) ++rightNo else 0
                    if (changesOnly && s == DiffStatus.UNCHANGED) continue
                    if (isCSV) {
                        writer.write(
                            "${statusCode(s)},${lnStr(ln)},${lnStr(rn)}," +
                                    "${csvField(row.left ?: "")},${csvField(row.right ?: "")}\r\n"
                        )
                    } else {
                        writer.write(textBlock(s, ln, rn, row.left ?: "", row.right ?: ""))
                    }
                }
            }
            val name = File(targetPath).name
            ApplicationManager.getApplication().invokeLater {
                JOptionPane.showMessageDialog(
                    null, "Exported to $name", "Export Complete", JOptionPane.INFORMATION_MESSAGE
                )
            }
        } catch (ex: Exception) {
            ApplicationManager.getApplication().invokeLater {
                JOptionPane.showMessageDialog(
                    null, "Export failed: ${ex.message}", "Export Error", JOptionPane.ERROR_MESSAGE
                )
            }
        }
    }

    // ── format helpers — ports from diffPanel.ts ──────────────────────────────

    // Lowercase codes for CSV, matching the VS Code export (STATUS_CODES in
    // extension/src/worker/messages.ts) so cross-IDE CSVs are byte-compatible.
    private fun statusCode(status: DiffStatus) = when (status) {
        DiffStatus.UNCHANGED -> "unchanged"
        DiffStatus.ADDED     -> "added"
        DiffStatus.REMOVED   -> "removed"
        DiffStatus.CHANGED   -> "changed"
    }

    private fun lnStr(n: Int) = if (n > 0) n.toString() else ""

    /**
     * RFC-4180 CSV field: wrap in double-quotes when the value contains a comma,
     * a double-quote, a CR, or a LF; double any embedded quotes.
     */
    internal fun csvField(value: String): String =
        if (value.contains(',') || value.contains('"') ||
            value.contains('\r') || value.contains('\n')
        ) {
            "\"${value.replace("\"", "\"\"")}\""
        } else {
            value
        }

    /**
     * One human-readable block per row (git-style markers), matching the
     * `textBlock` function in diffPanel.ts.
     */
    internal fun textBlock(
        status: DiffStatus, leftNo: Int, rightNo: Int, left: String, right: String
    ): String {
        val loc = "L${if (leftNo > 0) leftNo else "-"}  R${if (rightNo > 0) rightNo else "-"}"
        return when (status) {
            DiffStatus.ADDED      -> "ADDED      $loc\n  + $right\n"
            DiffStatus.REMOVED    -> "REMOVED    $loc\n  - $left\n"
            DiffStatus.CHANGED    -> "CHANGED    $loc\n  - $left\n  + $right\n"
            DiffStatus.UNCHANGED  -> "UNCHANGED  $loc\n    $left\n"
        }
    }
}

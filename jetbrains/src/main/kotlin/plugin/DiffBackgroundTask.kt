package com.adityakumar.plugin

import com.adityakumar.engine.Differ
import com.adityakumar.engine.DiffOptions
import com.adityakumar.engine.DiffResult
import com.adityakumar.engine.Reader
import com.adityakumar.engine.Sorter
import com.adityakumar.engine.SortOptions
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.Task
import com.intellij.openapi.project.Project

/**
 * Background task that reads two files, optionally sorts them, diffs them,
 * and reports results on the EDT.
 *
 * [options] wires the diff mode / key-column / case-insensitive / trim /
 * pairChanged settings chosen in the DiffPanel toolbar directly into the
 * Differ call.
 *
 * [sortOptions] — when non-null, both sides are sorted via [Sorter.sortLines]
 * before diffing, and the diff mode is forced to "set" (no positional pairing
 * after sorting — same rule as VS Code). Ignored when key-column mode is active
 * (the caller sets sortOptions=null in that case).
 */
class DiffBackgroundTask(
    project: Project,
    private val leftPath: String,
    private val rightPath: String,
    private val options: DiffOptions = DiffOptions(),
    private val sortOptions: SortOptions? = null,
    private val onResult: (DiffResult) -> Unit,
    private val onError: (String) -> Unit
) : Task.Backgroundable(project, "Large File Compare: comparing…", true) {

    override fun run(indicator: ProgressIndicator) {
        indicator.isIndeterminate = false
        indicator.fraction = 0.0
        indicator.text = "Checking files…"

        if (Reader.isProbablyBinary(leftPath) || Reader.isProbablyBinary(rightPath)) {
            postToUi { onError("Binary file detected — only text files can be compared.") }
            return
        }

        indicator.text = "Reading left file…"
        indicator.fraction = 0.1
        val leftLines = try { Reader.readLines(leftPath) } catch (ex: Exception) {
            postToUi { onError("Cannot read left file: ${ex.message}") }; return
        }

        indicator.checkCanceled()
        indicator.text = "Reading right file…"
        indicator.fraction = 0.4
        val rightLines = try { Reader.readLines(rightPath) } catch (ex: Exception) {
            postToUi { onError("Cannot read right file: ${ex.message}") }; return
        }

        indicator.checkCanceled()

        // When sort is requested, sort both sides and force set-diff mode (no positional
        // pairing makes sense after reordering — same rule as VS Code's worker).
        val (effectiveLeft, effectiveRight, effectiveOptions) = if (sortOptions != null) {
            indicator.text = "Sorting…"
            indicator.fraction = 0.55
            Triple(
                Sorter.sortLines(leftLines, sortOptions),
                Sorter.sortLines(rightLines, sortOptions),
                options.copy(mode = "set")
            )
        } else {
            Triple(leftLines, rightLines, options)
        }

        indicator.checkCanceled()
        indicator.text = "Diffing…"
        indicator.fraction = 0.7
        val result = Differ.diffLines(effectiveLeft, effectiveRight, effectiveOptions)

        indicator.fraction = 1.0
        postToUi { onResult(result) }
    }

    private fun postToUi(action: () -> Unit) {
        ApplicationManager.getApplication().invokeLater(action)
    }
}

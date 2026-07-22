package com.adityakumar.plugin

import com.adityakumar.engine.Differ
import com.adityakumar.engine.DiffOptions
import com.adityakumar.engine.DiffResult
import com.adityakumar.engine.Reader
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.Task
import com.intellij.openapi.project.Project

/**
 * Background task that reads two files, diffs them, and reports results on the EDT.
 *
 * [options] wires the diff mode / key-column / case-insensitive settings chosen in
 * the DiffPanel toolbar directly into the Differ call — nothing is hardcoded here.
 */
class DiffBackgroundTask(
    project: Project,
    private val leftPath: String,
    private val rightPath: String,
    private val options: DiffOptions = DiffOptions(),
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
        indicator.text = "Diffing…"
        indicator.fraction = 0.7
        val result = Differ.diffLines(leftLines, rightLines, options)

        indicator.fraction = 1.0
        postToUi { onResult(result) }
    }

    private fun postToUi(action: () -> Unit) {
        ApplicationManager.getApplication().invokeLater(action)
    }
}

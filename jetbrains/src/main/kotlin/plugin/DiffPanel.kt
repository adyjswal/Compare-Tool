package com.adityakumar.plugin

import com.adityakumar.engine.DiffSummary
import com.intellij.openapi.project.Project
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBScrollPane
import java.awt.BorderLayout
import java.awt.GridBagLayout
import javax.swing.JPanel
import javax.swing.SwingConstants

class DiffPanel(private val project: Project) : JPanel(BorderLayout()) {
    private val statusLabel = JBLabel(
        "<html><center>Large File Compare<br><small>Use Tools → Large File Compare to start</small></center></html>",
        SwingConstants.CENTER
    )

    init {
        val centrePanel = JPanel(GridBagLayout())
        centrePanel.add(statusLabel)
        add(JBScrollPane(centrePanel), BorderLayout.CENTER)
    }

    fun displayComparing() {
        statusLabel.text = "<html><center>Comparing…</center></html>"
        revalidate(); repaint()
    }

    fun displaySummary(summary: DiffSummary) {
        statusLabel.text = "<html><center>" +
            "<b>Comparison complete</b><br><br>" +
            "Unchanged: ${summary.unchanged} &nbsp;|&nbsp; " +
            "Added: ${summary.added} &nbsp;|&nbsp; " +
            "Removed: ${summary.removed} &nbsp;|&nbsp; " +
            "Changed: ${summary.changed}" +
            "</center></html>"
        revalidate(); repaint()
    }

    fun displayError(message: String) {
        statusLabel.text = "<html><center><b>Error:</b> ${message}</center></html>"
        revalidate(); repaint()
    }

    fun displayPlaceholder() {
        statusLabel.text = "<html><center>Large File Compare<br><small>Use Tools → Large File Compare to start</small></center></html>"
        revalidate(); repaint()
    }
}

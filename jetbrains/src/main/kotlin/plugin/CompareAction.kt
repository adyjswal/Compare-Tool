package com.adityakumar.plugin

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.fileChooser.FileChooser
import com.intellij.openapi.fileChooser.FileChooserDescriptor
import com.intellij.openapi.wm.ToolWindowManager

class CompareAction : AnAction("Compare Two Files", "Sort and compare two large text files", null) {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        // Equivalent to the (now-deprecated) FileChooserDescriptorFactory
        // .createSingleFileDescriptor(): choose exactly one file, no folders/jars.
        // The 6-boolean constructor exists since 2024.1 and is not deprecated.
        val descriptor = FileChooserDescriptor(true, false, false, false, false, false)

        val leftFile = FileChooser.chooseFile(descriptor.withTitle("Select Left File"), project, null) ?: return
        val rightFile = FileChooser.chooseFile(descriptor.withTitle("Select Right File"), project, null) ?: return

        // Ensure the tool window is visible
        val tw = ToolWindowManager.getInstance(project).getToolWindow("LargeFileCompare")
        tw?.show()

        // Delegate to DiffPanel, which owns the toolbar options and fires DiffBackgroundTask
        val diffPanel = project.getUserData(DiffToolWindowFactory.DIFF_PANEL_KEY) ?: return
        diffPanel.startComparison(leftFile.path, rightFile.path)
    }
}

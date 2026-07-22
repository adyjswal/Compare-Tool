package com.adityakumar.plugin

import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.ContentFactory

class DiffToolWindowFactory : ToolWindowFactory {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val diffPanel = DiffPanel(project)
        val content = ContentFactory.getInstance().createContent(diffPanel, "", false)
        toolWindow.contentManager.addContent(content)
        // Store the panel on the project so CompareAction can update it
        project.putUserData(DIFF_PANEL_KEY, diffPanel)
    }

    companion object {
        val DIFF_PANEL_KEY = com.intellij.openapi.util.Key.create<DiffPanel>("LargeFileCompare.DiffPanel")
    }
}

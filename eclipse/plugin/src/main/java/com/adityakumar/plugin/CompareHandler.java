package com.adityakumar.plugin;

import org.eclipse.core.commands.AbstractHandler;
import org.eclipse.core.commands.ExecutionEvent;
import org.eclipse.core.commands.ExecutionException;
import org.eclipse.swt.SWT;
import org.eclipse.swt.widgets.FileDialog;
import org.eclipse.swt.widgets.Shell;
import org.eclipse.ui.IWorkbenchPage;
import org.eclipse.ui.IWorkbenchWindow;
import org.eclipse.ui.PartInitException;
import org.eclipse.ui.PlatformUI;
import org.eclipse.ui.handlers.HandlerUtil;

public class CompareHandler extends AbstractHandler {
    @Override
    public Object execute(ExecutionEvent event) throws ExecutionException {
        IWorkbenchWindow window = HandlerUtil.getActiveWorkbenchWindow(event);
        if (window == null) return null;
        Shell shell = window.getShell();

        FileDialog dlg = new FileDialog(shell, SWT.OPEN);
        dlg.setText("Select Left File");
        String leftPath = dlg.open();
        if (leftPath == null) return null;

        dlg = new FileDialog(shell, SWT.OPEN);
        dlg.setText("Select Right File");
        String rightPath = dlg.open();
        if (rightPath == null) return null;

        IWorkbenchPage page = window.getActivePage();
        DiffViewPart view = null;
        try {
            view = (DiffViewPart) page.showView(DiffViewPart.VIEW_ID);
        } catch (PartInitException e) {
            throw new ExecutionException("Cannot open Large File Compare view", e);
        }

        final DiffViewPart finalView = view;
        new DiffBackgroundJob(leftPath, rightPath,
            result -> finalView.displaySummary(result.summary()),
            error   -> finalView.displayError(error)
        ).schedule();

        return null;
    }
}

package com.adityakumar.plugin;

import com.adityakumar.engine.DiffOptions;
import com.adityakumar.engine.SortOptions;

import org.eclipse.core.commands.AbstractHandler;
import org.eclipse.core.commands.ExecutionEvent;
import org.eclipse.core.commands.ExecutionException;
import org.eclipse.jface.window.Window;
import org.eclipse.swt.SWT;
import org.eclipse.swt.widgets.FileDialog;
import org.eclipse.swt.widgets.Shell;
import org.eclipse.ui.IWorkbenchPage;
import org.eclipse.ui.IWorkbenchWindow;
import org.eclipse.ui.PartInitException;
import org.eclipse.ui.handlers.HandlerUtil;

public class CompareHandler extends AbstractHandler {

    @Override
    public Object execute(ExecutionEvent event) throws ExecutionException {
        IWorkbenchWindow window = HandlerUtil.getActiveWorkbenchWindow(event);
        if (window == null) return null;
        Shell shell = window.getShell();

        // ---- 1. Choose files ----------------------------------------- //
        FileDialog dlg = new FileDialog(shell, SWT.OPEN);
        dlg.setText("Select Left File");
        String leftPath = dlg.open();
        if (leftPath == null) return null;

        dlg = new FileDialog(shell, SWT.OPEN);
        dlg.setText("Select Right File");
        String rightPath = dlg.open();
        if (rightPath == null) return null;

        // ---- 2. Choose diff options ----------------------------------- //
        CompareOptionsDialog optsDlg = new CompareOptionsDialog(shell);
        if (optsDlg.open() != Window.OK) return null;
        DiffOptions diffOpts = optsDlg.getDiffOptions();
        SortOptions sortOpts = optsDlg.getSortOptions();

        // ---- 3. Open the view ---------------------------------------- //
        IWorkbenchPage page = window.getActivePage();
        DiffViewPart view;
        try {
            view = (DiffViewPart) page.showView(DiffViewPart.VIEW_ID);
        } catch (PartInitException e) {
            throw new ExecutionException("Cannot open Large File Compare view", e);
        }

        // ---- 4. Hand off to the view (starts job + syncs toolbar) ---- //
        view.startComparison(leftPath, rightPath, diffOpts, sortOpts);

        return null;
    }
}

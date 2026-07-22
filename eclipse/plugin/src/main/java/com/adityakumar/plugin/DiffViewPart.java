package com.adityakumar.plugin;

import com.adityakumar.engine.DiffSummary;
import org.eclipse.swt.SWT;
import org.eclipse.swt.layout.GridData;
import org.eclipse.swt.layout.GridLayout;
import org.eclipse.swt.widgets.Composite;
import org.eclipse.swt.widgets.Label;
import org.eclipse.ui.part.ViewPart;

public class DiffViewPart extends ViewPart {
    public static final String VIEW_ID = "com.adityakumar.largefilecompare.view";

    private Label statusLabel;
    private Composite parent;

    @Override
    public void createPartControl(Composite parent) {
        this.parent = parent;
        parent.setLayout(new GridLayout(1, false));

        statusLabel = new Label(parent, SWT.CENTER | SWT.WRAP);
        statusLabel.setText("Large File Compare\nUse Large File Compare menu to compare two files.");
        statusLabel.setLayoutData(new GridData(SWT.CENTER, SWT.CENTER, true, true));
    }

    public void displaySummary(DiffSummary s) {
        if (statusLabel == null || statusLabel.isDisposed()) return;
        parent.getDisplay().asyncExec(() -> {
            if (!statusLabel.isDisposed()) {
                statusLabel.setText(
                    "Comparison complete\n\n" +
                    "Unchanged: " + s.unchanged() + "   " +
                    "Added: "     + s.added()     + "   " +
                    "Removed: "   + s.removed()   + "   " +
                    "Changed: "   + s.changed()
                );
                parent.layout(true);
            }
        });
    }

    public void displayError(String message) {
        if (statusLabel == null || statusLabel.isDisposed()) return;
        parent.getDisplay().asyncExec(() -> {
            if (!statusLabel.isDisposed()) {
                statusLabel.setText("Error: " + message);
                parent.layout(true);
            }
        });
    }

    @Override
    public void setFocus() { if (statusLabel != null && !statusLabel.isDisposed()) statusLabel.setFocus(); }
}

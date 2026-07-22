package com.adityakumar.plugin;

import com.adityakumar.engine.ColumnSpec;
import com.adityakumar.engine.DiffOptions;
import com.adityakumar.engine.SortOptions;

import org.eclipse.jface.dialogs.Dialog;
import org.eclipse.jface.dialogs.IDialogConstants;
import org.eclipse.swt.SWT;
import org.eclipse.swt.events.SelectionAdapter;
import org.eclipse.swt.events.SelectionEvent;
import org.eclipse.swt.layout.GridData;
import org.eclipse.swt.layout.GridLayout;
import org.eclipse.swt.widgets.Button;
import org.eclipse.swt.widgets.Combo;
import org.eclipse.swt.widgets.Composite;
import org.eclipse.swt.widgets.Control;
import org.eclipse.swt.widgets.Label;
import org.eclipse.swt.widgets.Shell;
import org.eclipse.swt.widgets.Text;

/**
 * Modal options dialog shown by {@link CompareHandler} before the diff runs.
 *
 * <p>Lets the user choose:
 * <ul>
 *   <li><b>Diff mode</b>: Positional (default), Set, or Key-column</li>
 *   <li><b>Delimiter + Key column</b> (1-based): only enabled in Key-column mode</li>
 *   <li><b>Sort order</b>: Original / Alphabetical ↑↓ / Numeric ↑↓</li>
 *   <li><b>Case-insensitive</b> checkbox</li>
 *   <li><b>Ignore whitespace (trim)</b> checkbox</li>
 *   <li><b>Show edits as changed (pair changed)</b> checkbox</li>
 * </ul>
 *
 * <p>Call {@link #open()} (blocks on the UI thread), then retrieve results
 * with {@link #getDiffOptions()} and {@link #getSortOptions()}.
 */
public class CompareOptionsDialog extends Dialog {

    // ---- collected results ----
    private String  mode           = "positional";
    private boolean caseInsensitive = false;
    private boolean trim            = true;
    private boolean pairChanged     = true;
    private String  delimiter       = ",";
    private int     keyColumn       = 1;
    private int     sortIndex       = 0;   // 0=Original,1=Alpha↑,2=Alpha↓,3=Num↑,4=Num↓

    // ---- widgets ----
    private Button radioPositional;
    private Button radioSet;
    private Button radioKey;
    private Button cbCaseInsensitive;
    private Button cbTrim;
    private Button cbPairChanged;
    private Text   txtDelimiter;
    private Text   txtKeyColumn;
    private Combo  comboSort;

    public CompareOptionsDialog(Shell parent) {
        super(parent);
        setShellStyle(getShellStyle() | SWT.RESIZE);
    }

    @Override
    protected void configureShell(Shell shell) {
        super.configureShell(shell);
        shell.setText("Large File Compare – Options");
    }

    @Override
    protected Control createDialogArea(Composite parent) {
        Composite area = (Composite) super.createDialogArea(parent);
        GridLayout layout = new GridLayout(2, false);
        layout.marginWidth    = 12;
        layout.marginHeight   = 10;
        layout.verticalSpacing = 8;
        area.setLayout(layout);

        // ---- Diff mode ------------------------------------------------ //
        Label modeLabel = new Label(area, SWT.NONE);
        modeLabel.setText("Diff mode:");
        modeLabel.setLayoutData(new GridData(SWT.LEFT, SWT.CENTER, false, false));

        Composite modeGroup = new Composite(area, SWT.NONE);
        modeGroup.setLayout(new GridLayout(3, false));
        modeGroup.setLayoutData(new GridData(SWT.FILL, SWT.CENTER, true, false));

        radioPositional = new Button(modeGroup, SWT.RADIO);
        radioPositional.setText("Positional");
        radioPositional.setToolTipText(
            "Line-by-line comparison in file order. "
            + "Similar removed+added pairs are reported as ‘changed’.");
        radioPositional.setSelection(true);

        radioSet = new Button(modeGroup, SWT.RADIO);
        radioSet.setText("Set");
        radioSet.setToolTipText(
            "Same as Positional but never pairs removed and added lines. "
            + "Use after sorting.");

        radioKey = new Button(modeGroup, SWT.RADIO);
        radioKey.setText("Key-column");
        radioKey.setToolTipText(
            "Match rows by a delimited key column. "
            + "Same key + different content = ‘changed’.");

        // ---- Key-column options --------------------------------------- //
        Label delimLabel = new Label(area, SWT.NONE);
        delimLabel.setText("Delimiter:");
        delimLabel.setLayoutData(new GridData(SWT.LEFT, SWT.CENTER, false, false));

        txtDelimiter = new Text(area, SWT.BORDER | SWT.SINGLE);
        txtDelimiter.setText(",");
        txtDelimiter.setEnabled(false);
        txtDelimiter.setLayoutData(new GridData(100, SWT.DEFAULT));

        Label colLabel = new Label(area, SWT.NONE);
        colLabel.setText("Key column (1-based):");
        colLabel.setLayoutData(new GridData(SWT.LEFT, SWT.CENTER, false, false));

        txtKeyColumn = new Text(area, SWT.BORDER | SWT.SINGLE);
        txtKeyColumn.setText("1");
        txtKeyColumn.setEnabled(false);
        txtKeyColumn.setLayoutData(new GridData(60, SWT.DEFAULT));

        // ---- Sort order ---------------------------------------------- //
        Label sortLabel = new Label(area, SWT.NONE);
        sortLabel.setText("Sort lines by:");
        sortLabel.setLayoutData(new GridData(SWT.LEFT, SWT.CENTER, false, false));

        comboSort = new Combo(area, SWT.DROP_DOWN | SWT.READ_ONLY);
        comboSort.add("Original (no sort)");
        comboSort.add("Alphabetical ↑ (A→Z)");
        comboSort.add("Alphabetical ↓ (Z→A)");
        comboSort.add("Numeric ↑ (0→9)");
        comboSort.add("Numeric ↓ (9→0)");
        comboSort.select(0);
        comboSort.setLayoutData(new GridData(SWT.LEFT, SWT.CENTER, false, false));
        comboSort.setToolTipText(
            "Sort both files before comparing. "
            + "Ignored when Key-column mode is active. "
            + "Forces Set diff mode.");

        // ---- Case sensitivity ----------------------------------------- //
        new Label(area, SWT.NONE); // left-column spacer
        cbCaseInsensitive = new Button(area, SWT.CHECK);
        cbCaseInsensitive.setText("Case-insensitive comparison");
        cbCaseInsensitive.setLayoutData(new GridData(SWT.LEFT, SWT.CENTER, false, false));

        // ---- Trim whitespace ------------------------------------------ //
        new Label(area, SWT.NONE);
        cbTrim = new Button(area, SWT.CHECK);
        cbTrim.setText("Ignore leading/trailing whitespace");
        cbTrim.setSelection(true);   // default: trim is on
        cbTrim.setLayoutData(new GridData(SWT.LEFT, SWT.CENTER, false, false));

        // ---- Pair changed --------------------------------------------- //
        new Label(area, SWT.NONE);
        cbPairChanged = new Button(area, SWT.CHECK);
        cbPairChanged.setText("Show similar edits as ‘changed’ (positional mode only)");
        cbPairChanged.setSelection(true);   // default: pair changed is on
        cbPairChanged.setLayoutData(new GridData(SWT.LEFT, SWT.CENTER, false, false));

        // ---- Enable key fields only when Key-column mode is chosen ---- //
        SelectionAdapter modeListener = new SelectionAdapter() {
            @Override
            public void widgetSelected(SelectionEvent e) {
                boolean keyMode = radioKey.getSelection();
                txtDelimiter.setEnabled(keyMode);
                txtKeyColumn.setEnabled(keyMode);
            }
        };
        radioPositional.addSelectionListener(modeListener);
        radioSet.addSelectionListener(modeListener);
        radioKey.addSelectionListener(modeListener);

        return area;
    }

    @Override
    protected void createButtonsForButtonBar(Composite parent) {
        createButton(parent, IDialogConstants.OK_ID,     "Compare", true);
        createButton(parent, IDialogConstants.CANCEL_ID, IDialogConstants.CANCEL_LABEL, false);
    }

    @Override
    protected void okPressed() {
        if (radioKey.getSelection()) {
            mode = "key";
        } else if (radioSet.getSelection()) {
            mode = "set";
        } else {
            mode = "positional";
        }
        caseInsensitive = cbCaseInsensitive.getSelection();
        trim            = cbTrim.getSelection();
        pairChanged     = cbPairChanged.getSelection();
        sortIndex       = comboSort.getSelectionIndex();
        delimiter       = txtDelimiter.getText().isEmpty() ? "," : txtDelimiter.getText();
        try {
            keyColumn = Integer.parseInt(txtKeyColumn.getText().trim());
            if (keyColumn < 1) keyColumn = 1;
        } catch (NumberFormatException ex) {
            keyColumn = 1;
        }
        super.okPressed();
    }

    /**
     * Returns the {@link DiffOptions} built from the user's selections.
     * Only meaningful after {@link #open()} has returned {@code Window.OK}.
     */
    public DiffOptions getDiffOptions() {
        if ("key".equals(mode)) {
            ColumnSpec cs = new ColumnSpec(delimiter, keyColumn);
            return new DiffOptions("positional", cs, trim, caseInsensitive, pairChanged);
        }
        return new DiffOptions(mode, null, trim, caseInsensitive, pairChanged);
    }

    /**
     * Returns the {@link SortOptions} chosen, or {@code null} if "Original (no sort)"
     * was selected.  Only meaningful after {@link #open()} has returned {@code Window.OK}.
     */
    public SortOptions getSortOptions() {
        return switch (sortIndex) {
            case 1 -> new SortOptions(SortOptions.Mode.ALPHABETICAL, SortOptions.Direction.ASC,  true,  true, null);
            case 2 -> new SortOptions(SortOptions.Mode.ALPHABETICAL, SortOptions.Direction.DESC, true,  true, null);
            case 3 -> new SortOptions(SortOptions.Mode.NUMERIC,      SortOptions.Direction.ASC,  false, true, null);
            case 4 -> new SortOptions(SortOptions.Mode.NUMERIC,      SortOptions.Direction.DESC, false, true, null);
            default -> null;  // Original: no sort
        };
    }
}

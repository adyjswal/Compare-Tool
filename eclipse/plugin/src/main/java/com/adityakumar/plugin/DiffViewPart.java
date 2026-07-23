package com.adityakumar.plugin;

import com.adityakumar.engine.DiffOptions;
import com.adityakumar.engine.DiffResult;
import com.adityakumar.engine.DiffRow;
import com.adityakumar.engine.DiffStatus;
import com.adityakumar.engine.DiffSummary;
import com.adityakumar.engine.DisplayRowModel;
import com.adityakumar.engine.SortOptions;
import com.adityakumar.engine.WordDiff;

import org.eclipse.core.runtime.IProgressMonitor;
import org.eclipse.core.runtime.IStatus;
import org.eclipse.core.runtime.Status;
import org.eclipse.core.runtime.jobs.Job;
import org.eclipse.jface.action.Action;
import org.eclipse.jface.action.ControlContribution;
import org.eclipse.jface.action.IAction;
import org.eclipse.jface.action.IToolBarManager;
import org.eclipse.jface.action.Separator;
import org.eclipse.jface.dialogs.MessageDialog;
import org.eclipse.jface.viewers.ColumnLabelProvider;
import org.eclipse.jface.viewers.ILazyContentProvider;
import org.eclipse.jface.viewers.StyledCellLabelProvider;
import org.eclipse.jface.viewers.TableViewer;
import org.eclipse.jface.viewers.TableViewerColumn;
import org.eclipse.jface.viewers.Viewer;
import org.eclipse.jface.viewers.ViewerCell;
import org.eclipse.swt.SWT;
import org.eclipse.swt.custom.StyleRange;
import org.eclipse.swt.events.KeyAdapter;
import org.eclipse.swt.events.KeyEvent;
import org.eclipse.swt.events.SelectionAdapter;
import org.eclipse.swt.events.SelectionEvent;
import org.eclipse.swt.graphics.Color;
import org.eclipse.swt.graphics.GC;
import org.eclipse.swt.graphics.Point;
import org.eclipse.swt.layout.GridData;
import org.eclipse.swt.layout.GridLayout;
import org.eclipse.swt.widgets.Canvas;
import org.eclipse.swt.widgets.Combo;
import org.eclipse.swt.widgets.Composite;
import org.eclipse.swt.widgets.Control;
import org.eclipse.swt.widgets.Display;
import org.eclipse.swt.widgets.FileDialog;
import org.eclipse.swt.widgets.Label;
import org.eclipse.swt.widgets.Table;
import org.eclipse.swt.widgets.TableItem;
import org.eclipse.swt.widgets.Text;
import org.eclipse.ui.part.ViewPart;

import java.io.BufferedWriter;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;

/**
 * Side-by-side diff view for Large File Compare.
 *
 * <p>Uses an SWT {@code VIRTUAL} TableViewer so Eclipse only materialises
 * TableItem widgets for the rows currently visible in the viewport.  For a
 * 1 M-row result only ~50-100 TableItem objects ever exist at once; the
 * in-memory {@code List<RowEntry>} is accessed at O(1) via index.
 *
 * <p><b>Toolbar</b> — built once in {@link #createPartControl} via
 * {@link IToolBarManager}; contains a View-mode combo (All / Changes / Collapsed),
 * a Sort combo (Original / Alpha ↑↓ / Numeric ↑↓), three toggle buttons
 * (Trim / Pair / Ci), a Find field with navigation and options, and an Export
 * button.  Toolbar changes trigger {@link #recomputeFromToolbar()} (which spawns
 * a fresh {@link DiffBackgroundJob}) or {@link #rebuildDisplayModel()} (view-only).
 *
 * <p><b>Feature parity with the VS Code extension</b> — beyond the diff itself
 * this viewer mirrors three webview features:
 * <ul>
 *   <li><b>Inline word-level diff</b> — {@link WordDiff} highlights the differing
 *       span within a "changed" row on each side (see {@link TextCellLabelProvider}).</li>
 *   <li><b>Overview ruler</b> — a narrow {@link Canvas} change-map beside the
 *       table, drawn in display space, click-to-navigate (see {@link #paintRuler}).</li>
 *   <li><b>Collapsed / changes view</b> — {@link DisplayRowModel} folds runs of
 *       unchanged rows; the view-mode combo selects All / Changes-only / Collapsed.</li>
 * </ul>
 *
 * <p><b>Request-generation guard</b> — a monotonic {@code requestGen} counter
 * (mirrors the VS Code extension's {@code requestId}) ensures that stale
 * results from superseded jobs are silently discarded.
 *
 * <p><b>Sort precedence</b>: key-column &gt; sort &gt; positional (see
 * {@link DiffBackgroundJob}).
 */
public class DiffViewPart extends ViewPart {

    public static final String VIEW_ID = "com.adityakumar.largefilecompare.view";

    /** Overview-ruler width in pixels (mirrors OverviewRuler.RULER_WIDTH). */
    private static final int RULER_WIDTH = 14;
    /** Fixed row-height fallback used for the viewport box maths. */
    private static final int ROW_HEIGHT_FALLBACK = 20;

    // ------------------------------------------------------------------ //
    //  UI fields                                                           //
    // ------------------------------------------------------------------ //

    private Composite root;
    private Label     summaryLabel;
    private TableViewer tableViewer;
    private Canvas    ruler;

    /** Row-status palette — allocated in createPartControl, disposed with the table. */
    private Color colorAdded;
    private Color colorRemoved;
    private Color colorChanged;
    /** Fold-marker row background. */
    private Color colorFold;
    /** Inline word-diff span backgrounds (stronger tints of removed/added). */
    private Color colorWordDel;
    private Color colorWordAdd;
    /** Overview-ruler palette. */
    private Color rulerRed;
    private Color rulerGreen;
    private Color rulerBox;
    private Color rulerBoxBorder;
    private Color rulerMarker;

    // ------------------------------------------------------------------ //
    //  Toolbar widget references (null until ControlContribution creates)  //
    // ------------------------------------------------------------------ //

    /** 0=All rows, 1=Changes only, 2=Collapsed */
    private int   viewModeIndex = 0;
    private Combo viewCombo;    // may be null during createPartControl

    /** 0=Original, 1=Alpha↑, 2=Alpha↓, 3=Num↑, 4=Num↓ */
    private int   sortComboIndex = 0;
    private Combo sortCombo;   // may be null during createPartControl
    private Text  findText;    // may be null during createPartControl

    // Toggle Actions — created in createToolbar()
    private Action trimAction;
    private Action pairChangedAction;
    private Action caseInsAction;
    private Action findCaseAction;
    private Action findRegexAction;

    // ------------------------------------------------------------------ //
    //  Data model                                                          //
    // ------------------------------------------------------------------ //

    /**
     * A single display row: the underlying diff row plus precomputed 1-based
     * line numbers (0 = the side has no text on this row).
     */
    private record RowEntry(DiffRow row, int leftNo, int rightNo) {}

    /** Null until the first successful comparison completes. */
    private volatile List<RowEntry> entries;

    /**
     * The display-row model mapping display index → absolute row / fold marker
     * for the current view mode.  Null = identity (treat display index as
     * absolute; used before the first comparison).
     */
    private volatile DisplayRowModel.Model displayModel;

    /** Set of {@code runStart} values the user has expanded (collapsed mode). */
    private final Set<Integer> expandedFolds = new HashSet<>();

    /**
     * Per-display-row status bytes for the overview ruler (0=unchanged,
     * 1=added, 2=removed, 3=changed).  Length equals {@code displayModel.count}.
     */
    private volatile byte[] rulerStatuses = new byte[0];

    // ------------------------------------------------------------------ //
    //  Comparison state                                                    //
    // ------------------------------------------------------------------ //

    private String leftPath;
    private String rightPath;

    /**
     * Latest effective {@link DiffOptions}: preserves mode/key from the
     * initial dialog so that toolbar-triggered recomputes inherit them.
     */
    private DiffOptions lastDiffOpts = new DiffOptions();

    /**
     * Monotonic counter — incremented on every new comparison.
     * Each job captures the value at submission and discards its result if
     * the current value no longer matches (a newer job has superseded it).
     */
    private volatile int requestGen = 0;

    // ------------------------------------------------------------------ //
    //  Find state                                                          //
    // ------------------------------------------------------------------ //

    /** Matching ABSOLUTE row indices (into {@link #entries}). */
    private int[] findMatches = new int[0];
    private int   findCursor  = -1;

    /**
     * Monotonic counter for find scans — same stale-guard pattern as
     * {@code requestGen} on the comparison path.  Incremented on the UI
     * thread each time a new scan is launched; the background job checks it
     * on every row and in its final {@code asyncExec} callback so that a
     * slow scan from a superseded query can never overwrite a newer result.
     */
    private volatile int findGen = 0;

    // ================================================================== //
    //  ViewPart lifecycle                                                  //
    // ================================================================== //

    @Override
    public void createPartControl(Composite parent) {
        root = new Composite(parent, SWT.NONE);
        root.setLayout(new GridLayout(1, false));

        // Toolbar must be built before the widgets so Actions exist.
        createToolbar();

        // ---- summary bar ----
        summaryLabel = new Label(root, SWT.NONE);
        summaryLabel.setText(
            "Large File Compare — use Large File Compare › Compare Two Files… to start.");
        summaryLabel.setLayoutData(new GridData(SWT.FILL, SWT.CENTER, true, false));

        // ---- palette ----
        Display display = parent.getDisplay();
        colorAdded   = new Color(display, 214, 255, 214); // pale green
        colorRemoved = new Color(display, 255, 210, 210); // pale red
        colorChanged = new Color(display, 255, 255, 200); // pale yellow
        colorFold    = new Color(display, 232, 232, 238); // neutral fold marker
        colorWordDel = new Color(display, 255, 160, 160); // stronger red (left changed span)
        colorWordAdd = new Color(display, 150, 220, 150); // stronger green (right changed span)
        rulerRed       = new Color(display, 248,  81,  73);
        rulerGreen     = new Color(display,  46, 160,  67);
        rulerBox       = new Color(display, 128, 128, 128);
        rulerBoxBorder = new Color(display, 160, 160, 160);
        rulerMarker    = new Color(display,  77, 170, 252);

        // ---- table + overview ruler, side by side ----
        Composite tableComp = new Composite(root, SWT.NONE);
        tableComp.setLayoutData(new GridData(SWT.FILL, SWT.FILL, true, true));
        GridLayout tcl = new GridLayout(2, false);
        tcl.marginWidth = 0; tcl.marginHeight = 0; tcl.horizontalSpacing = 0;
        tableComp.setLayout(tcl);

        // ---- virtual table ----
        //
        // SWT.VIRTUAL: only calls updateElement() for rows in the viewport.
        // At 1 M rows only ~80 TableItem objects exist at any one time.
        Table table = new Table(tableComp,
                SWT.VIRTUAL | SWT.BORDER | SWT.FULL_SELECTION
                | SWT.MULTI | SWT.V_SCROLL | SWT.H_SCROLL);
        table.setHeaderVisible(true);
        table.setLinesVisible(false);
        table.setLayoutData(new GridData(SWT.FILL, SWT.FILL, true, true));

        // ---- overview ruler ----
        ruler = new Canvas(tableComp, SWT.NO_BACKGROUND);
        GridData rulerData = new GridData(SWT.CENTER, SWT.FILL, false, true);
        rulerData.widthHint = RULER_WIDTH;
        ruler.setLayoutData(rulerData);
        ruler.addPaintListener(pe -> paintRuler(pe.gc));
        ruler.addListener(SWT.MouseDown, e -> onRulerClick(e.y));

        tableViewer = new TableViewer(table);

        addColumn(0, "#",      45,  SWT.RIGHT); // left line number
        addColumn(1, "Left",  600,  SWT.LEFT);  // left text
        addColumn(2, "#",      45,  SWT.RIGHT); // right line number
        addColumn(3, "Right", 600,  SWT.LEFT);  // right text

        tableViewer.setContentProvider(new ILazyContentProvider() {
            @Override
            public void updateElement(int index) {
                List<RowEntry> snap = entries;
                if (snap == null) return;
                DisplayRowModel.Model m = displayModel;
                if (m == null) {
                    // Identity fallback (no model yet): display index == absolute row.
                    if (index >= 0 && index < snap.size()) {
                        tableViewer.replace(snap.get(index), index);
                    }
                    return;
                }
                if (index < 0 || index >= m.count) return;
                int abs = m.absoluteOf(index);
                if (abs >= 0) {
                    if (abs < snap.size()) tableViewer.replace(snap.get(abs), index);
                } else {
                    DisplayRowModel.Fold fold = m.foldAt(index);
                    if (fold != null) tableViewer.replace(fold, index);
                }
            }
            @Override public void dispose() {}
            @Override public void inputChanged(Viewer v, Object oldInput, Object newInput) {}
        });

        tableViewer.setInput(new Object());
        tableViewer.setItemCount(0);

        // Click a fold marker to expand it.
        table.addListener(SWT.MouseDown, e -> {
            TableItem item = table.getItem(new Point(e.x, e.y));
            if (item == null) return;
            DisplayRowModel.Model m = displayModel;
            if (m == null) return;
            int disp = table.indexOf(item);
            DisplayRowModel.Fold fold = m.foldAt(disp);
            if (fold != null) {
                expandedFolds.add(fold.runStart);
                rebuildDisplayModel();
            }
        });

        // Keep the ruler's viewport box + current-row marker in sync with the
        // table.  A Paint listener catches every scroll cause (wheel, keys,
        // scrollbar) and only redraws the ruler when the top row actually moved.
        final int[] lastTop = { -1 };
        table.addListener(SWT.Paint, e -> {
            int top = table.getTopIndex();
            if (top != lastTop[0]) { lastTop[0] = top; redrawRuler(); }
        });
        table.addListener(SWT.Selection, e -> redrawRuler());
        table.addListener(SWT.Resize,    e -> redrawRuler());

        table.addDisposeListener(e -> {
            safeDispose(colorAdded);
            safeDispose(colorRemoved);
            safeDispose(colorChanged);
            safeDispose(colorFold);
            safeDispose(colorWordDel);
            safeDispose(colorWordAdd);
            safeDispose(rulerRed);
            safeDispose(rulerGreen);
            safeDispose(rulerBox);
            safeDispose(rulerBoxBorder);
            safeDispose(rulerMarker);
        });
    }

    @Override
    public void setFocus() {
        if (tableViewer != null && !tableViewer.getTable().isDisposed()) {
            tableViewer.getTable().setFocus();
        }
    }

    // ================================================================== //
    //  Toolbar construction                                                //
    // ================================================================== //

    private void createToolbar() {
        IToolBarManager tbm = getViewSite().getActionBars().getToolBarManager();

        // ---- View-mode combo ---- //
        tbm.add(new ControlContribution("lfc.view") {
            @Override
            protected Control createControl(Composite parent) {
                viewCombo = new Combo(parent, SWT.DROP_DOWN | SWT.READ_ONLY);
                viewCombo.add("All rows");
                viewCombo.add("Changes only");
                viewCombo.add("Collapsed");
                viewCombo.select(viewModeIndex);
                viewCombo.setToolTipText(
                    "Which rows to show:\n"
                    + "All rows — every row.\n"
                    + "Changes only — hide unchanged rows.\n"
                    + "Collapsed — fold long unchanged runs (click a fold to expand).");
                viewCombo.addSelectionListener(new SelectionAdapter() {
                    @Override
                    public void widgetSelected(SelectionEvent e) {
                        viewModeIndex = viewCombo.getSelectionIndex();
                        rebuildDisplayModel();   // view-only: no re-diff needed
                    }
                });
                return viewCombo;
            }

            @Override
            protected int computeWidth(Control control) {
                return 110;
            }
        });

        // ---- Sort combo ---- //
        tbm.add(new ControlContribution("lfc.sort") {
            @Override
            protected Control createControl(Composite parent) {
                sortCombo = new Combo(parent, SWT.DROP_DOWN | SWT.READ_ONLY);
                sortCombo.add("Original");
                sortCombo.add("Alpha ↑");
                sortCombo.add("Alpha ↓");
                sortCombo.add("Num ↑");
                sortCombo.add("Num ↓");
                sortCombo.select(sortComboIndex);
                sortCombo.setToolTipText(
                    "Sort both files before comparing.\n"
                    + "Ignored when key-column mode is active (key takes precedence).\n"
                    + "Forces Set diff mode when active.");
                sortCombo.addSelectionListener(new SelectionAdapter() {
                    @Override
                    public void widgetSelected(SelectionEvent e) {
                        sortComboIndex = sortCombo.getSelectionIndex();
                        recomputeFromToolbar();
                    }
                });
                return sortCombo;
            }

            @Override
            protected int computeWidth(Control control) {
                return 95;
            }
        });

        // ---- Trim toggle ---- //
        trimAction = new Action("Trim", IAction.AS_CHECK_BOX) {
            @Override public void run() { recomputeFromToolbar(); }
        };
        trimAction.setToolTipText("Ignore leading/trailing whitespace during comparison");
        trimAction.setChecked(true);
        tbm.add(trimAction);

        // ---- Pair-changed toggle ---- //
        pairChangedAction = new Action("Pair", IAction.AS_CHECK_BOX) {
            @Override public void run() { recomputeFromToolbar(); }
        };
        pairChangedAction.setToolTipText(
            "Show similar removed+added lines as a single 'changed' row (positional mode only)");
        pairChangedAction.setChecked(true);
        tbm.add(pairChangedAction);

        // ---- Case-insensitive toggle ---- //
        caseInsAction = new Action("Ci", IAction.AS_CHECK_BOX) {
            @Override public void run() { recomputeFromToolbar(); }
        };
        caseInsAction.setToolTipText("Case-insensitive comparison");
        caseInsAction.setChecked(false);
        tbm.add(caseInsAction);

        tbm.add(new Separator());

        // ---- Find text field ---- //
        tbm.add(new ControlContribution("lfc.find") {
            @Override
            protected Control createControl(Composite parent) {
                findText = new Text(parent, SWT.SINGLE | SWT.BORDER);
                findText.setMessage("Find…");
                findText.addModifyListener(e -> {
                    findCursor = -1;
                    runFind();
                });
                findText.addKeyListener(new KeyAdapter() {
                    @Override
                    public void keyPressed(KeyEvent e) {
                        if (e.keyCode == SWT.CR || e.keyCode == SWT.KEYPAD_CR) {
                            // Shift+Enter → previous; Enter → next
                            navigateFind((e.stateMask & SWT.SHIFT) == 0);
                        }
                    }
                });
                return findText;
            }

            @Override
            protected int computeWidth(Control control) {
                return 160;
            }
        });

        // ---- Find prev ---- //
        Action findPrevAction = new Action("▲") {
            @Override public void run() { navigateFind(false); }
        };
        findPrevAction.setToolTipText("Find previous (Shift+Enter)");
        tbm.add(findPrevAction);

        // ---- Find next ---- //
        Action findNextAction = new Action("▼") {
            @Override public void run() { navigateFind(true); }
        };
        findNextAction.setToolTipText("Find next (Enter)");
        tbm.add(findNextAction);

        // ---- Find: case-sensitive toggle ---- //
        findCaseAction = new Action("Aa", IAction.AS_CHECK_BOX) {
            @Override public void run() { findCursor = -1; runFind(); }
        };
        findCaseAction.setToolTipText("Case-sensitive find");
        tbm.add(findCaseAction);

        // ---- Find: regex toggle ---- //
        findRegexAction = new Action(".*", IAction.AS_CHECK_BOX) {
            @Override public void run() { findCursor = -1; runFind(); }
        };
        findRegexAction.setToolTipText("Regular expression find");
        tbm.add(findRegexAction);

        tbm.add(new Separator());

        // ---- Export ---- //
        Action exportAction = new Action("Export…") {
            @Override public void run() { exportDiff(); }
        };
        exportAction.setToolTipText("Export diff to CSV or plain-text file");
        tbm.add(exportAction);

        getViewSite().getActionBars().updateActionBars();
    }

    // ================================================================== //
    //  Public API — called by CompareHandler                              //
    // ================================================================== //

    /**
     * Start a new comparison and prime the toolbar with the initial options
     * chosen in the dialog.  Safe to call on the UI thread only.
     *
     * @param left     absolute path to the left file
     * @param right    absolute path to the right file
     * @param diffOpts diff options from the dialog (mode, key, trim, …)
     * @param sortOpts sort options from the dialog, or {@code null} for none
     */
    public void startComparison(String left, String right,
                                DiffOptions diffOpts, SortOptions sortOpts) {
        this.leftPath  = left;
        this.rightPath = right;

        // Sync toolbar to match dialog choices so subsequent toolbar changes
        // are consistent with the initial run.
        sortComboIndex = sortOptionsToIndex(sortOpts);
        if (sortCombo        != null && !sortCombo.isDisposed()) sortCombo.select(sortComboIndex);
        if (trimAction       != null) trimAction.setChecked(diffOpts.trim);
        if (pairChangedAction != null) pairChangedAction.setChecked(diffOpts.pairChanged);
        if (caseInsAction    != null) caseInsAction.setChecked(diffOpts.caseInsensitive);

        runComparison(diffOpts, sortOpts);
    }

    // ================================================================== //
    //  Comparison logic                                                    //
    // ================================================================== //

    /**
     * Read toolbar state and re-run the comparison with updated options.
     * Called by every toolbar toggle/combo change.  No-op if no files
     * have been set yet.
     */
    private void recomputeFromToolbar() {
        if (leftPath == null) return;
        // Preserve the original mode/key (positional vs set vs key-column);
        // only update the toggles.
        DiffOptions opts = new DiffOptions(
            lastDiffOpts.mode,
            lastDiffOpts.key,
            trimAction.isChecked(),
            caseInsAction.isChecked(),
            pairChangedAction.isChecked());
        runComparison(opts, indexToSortOptions(sortComboIndex));
    }

    /**
     * Submit a {@link DiffBackgroundJob} for the current file pair.
     *
     * <p>Captures the current {@code requestGen} value in the result/error
     * callbacks; stale responses from superseded jobs are silently discarded.
     * Must be called on the UI thread.
     */
    private void runComparison(DiffOptions opts, SortOptions sortOpts) {
        lastDiffOpts = opts;
        updatePairChangedState();   // grey out Pair when sort/key/set mode active
        final int gen = ++requestGen;

        summaryLabel.setText("Comparing…");
        entries = null;
        displayModel = null;
        rulerStatuses = new byte[0];
        tableViewer.setItemCount(0);
        redrawRuler();

        DiffBackgroundJob job = new DiffBackgroundJob(
            leftPath, rightPath, opts, sortOpts,
            result -> {
                // Called on job thread — check gen before dispatching to UI.
                if (gen != requestGen) return;
                if (root == null || root.isDisposed()) return;
                root.getDisplay().asyncExec(() -> {
                    if (!root.isDisposed() && gen == requestGen) displayResult(result);
                });
            },
            err -> {
                if (gen != requestGen) return;
                if (root == null || root.isDisposed()) return;
                root.getDisplay().asyncExec(() -> {
                    if (!root.isDisposed() && gen == requestGen) displayError(err);
                });
            });
        job.schedule();
    }

    // ================================================================== //
    //  Result display                                                      //
    // ================================================================== //

    /**
     * Display a completed diff result.  Must be called on the UI thread
     * (typically via {@code asyncExec} from the job callback in
     * {@link #runComparison}).
     */
    public void displayResult(DiffResult result) {
        if (root == null || root.isDisposed()) return;

        // Build the flat RowEntry list with precomputed 1-based line numbers.
        List<DiffRow> rows = result.rows();
        List<RowEntry> newEntries = new ArrayList<>(rows.size());
        int lNo = 1, rNo = 1;
        for (DiffRow row : rows) {
            int leftNo  = (row.left()  != null) ? lNo : 0;
            int rightNo = (row.right() != null) ? rNo : 0;
            newEntries.add(new RowEntry(row, leftNo, rightNo));
            if (row.left()  != null) lNo++;
            if (row.right() != null) rNo++;
        }
        entries = newEntries;
        // A fresh result invalidates any previously expanded folds.
        expandedFolds.clear();

        DiffSummary s = result.summary();
        summaryLabel.setText(String.format(
            "Total: %,d rows  │  Unchanged: %,d  │  Added: %,d  "
            + "│  Removed: %,d  │  Changed: %,d",
            s.total(), s.unchanged(), s.added(), s.removed(), s.changed()));

        rebuildDisplayModel();
        root.layout(true, true);

        // If there is an active find query, re-run it against the new data.
        if (findText != null && !findText.isDisposed() && !findText.getText().isEmpty()) {
            findCursor = -1;
            runFind();
        }
    }

    /** Display an error message.  Must be called on the UI thread. */
    public void displayError(String message) {
        if (root == null || root.isDisposed()) return;
        entries = null;
        displayModel = null;
        rulerStatuses = new byte[0];
        tableViewer.setItemCount(0);
        redrawRuler();
        summaryLabel.setText("Error: " + message);
        root.layout(true);
    }

    // ================================================================== //
    //  Display-row model (view modes + folds)                             //
    // ================================================================== //

    /**
     * Rebuild the {@link DisplayRowModel} for the current view mode and push
     * the new row count to the virtual table and the overview ruler.  Cheap:
     * no re-diff, just a re-map over the existing {@link #entries}.  Must be
     * called on the UI thread.
     */
    private void rebuildDisplayModel() {
        List<RowEntry> snap = entries;
        if (snap == null) {
            displayModel = null;
            rulerStatuses = new byte[0];
            if (tableViewer != null) tableViewer.setItemCount(0);
            redrawRuler();
            return;
        }

        byte[] statuses = new byte[snap.size()];
        for (int i = 0; i < snap.size(); i++) {
            statuses[i] = statusByte(snap.get(i).row().status());
        }

        DisplayRowModel.ViewMode mode = viewModeFromIndex(viewModeIndex);
        DisplayRowModel.Model m = DisplayRowModel.build(
            statuses, mode, DisplayRowModel.CONTEXT_ROWS, expandedFolds);
        displayModel = m;

        // Ruler draws in display space: use per-display statuses when the model
        // supplies them (changes/collapsed), else the raw per-row statuses (all).
        rulerStatuses = (m.displayStatuses != null) ? m.displayStatuses : statuses;

        Table table = tableViewer.getTable();
        tableViewer.setItemCount(m.count);
        if (!table.isDisposed()) table.clearAll();
        redrawRuler();
    }

    /** Map the view combo index (0/1/2) to a {@link DisplayRowModel.ViewMode}. */
    private static DisplayRowModel.ViewMode viewModeFromIndex(int idx) {
        return switch (idx) {
            case 1  -> DisplayRowModel.ViewMode.CHANGES;
            case 2  -> DisplayRowModel.ViewMode.COLLAPSED;
            default -> DisplayRowModel.ViewMode.ALL;
        };
    }

    /** Map a {@link DiffStatus} to the ruler/display status byte (0..3). */
    private static byte statusByte(DiffStatus status) {
        return switch (status) {
            case UNCHANGED -> 0;
            case ADDED     -> 1;
            case REMOVED   -> 2;
            case CHANGED   -> 3;
        };
    }

    // ================================================================== //
    //  Overview ruler                                                      //
    // ================================================================== //

    /** Schedule a ruler repaint if it still exists. */
    private void redrawRuler() {
        if (ruler != null && !ruler.isDisposed()) ruler.redraw();
    }

    /**
     * Paint the overview ruler: red (removed/changed) bands on the left half,
     * green (added/changed) on the right half, a translucent viewport box, and
     * a blue current-row marker.  Operates entirely in DISPLAY space.
     */
    private void paintRuler(GC gc) {
        if (ruler == null || ruler.isDisposed()) return;
        int h = ruler.getBounds().height;
        int w = RULER_WIDTH;

        // Clear (SWT.NO_BACKGROUND means we own the pixels).
        gc.setBackground(ruler.getDisplay().getSystemColor(SWT.COLOR_WIDGET_BACKGROUND));
        gc.fillRectangle(0, 0, w, h);

        byte[] st = rulerStatuses;
        int count = st.length;
        if (count <= 0 || h <= 0) return;

        int half = w / 2;

        // 1. Change bands (2 px tall), translucent to match the webview canvas.
        gc.setAlpha(217);
        for (int i = 0; i < count; i++) {
            int s = st[i] & 0xFF;
            if (s == 0) continue;
            int y = (int) ((i + 0.5) / count * h);
            if (y < 0) y = 0;
            if (y >= h) y = h - 1;
            if (s == 2 || s == 3) { gc.setBackground(rulerRed);   gc.fillRectangle(0,    y, half,     2); }
            if (s == 1 || s == 3) { gc.setBackground(rulerGreen); gc.fillRectangle(half, y, w - half, 2); }
        }
        gc.setAlpha(255);

        // 2. Viewport box.
        Table table = tableViewer.getTable();
        int itemH = table.getItemHeight() > 0 ? table.getItemHeight() : ROW_HEIGHT_FALLBACK;
        int visible = Math.max(1, table.getClientArea().height / itemH);
        int top = table.getTopIndex();
        int y0 = (int) ((double) top / count * h);
        int y1 = (int) ((double) (top + visible) / count * h);
        int boxH = Math.max(2, y1 - y0);
        if (y0 > h - boxH) y0 = Math.max(0, h - boxH);
        gc.setAlpha(56);
        gc.setBackground(rulerBox);
        gc.fillRectangle(0, y0, w, boxH);
        gc.setAlpha(140);
        gc.setForeground(rulerBoxBorder);
        gc.drawRectangle(0, y0, w - 1, boxH - 1);
        gc.setAlpha(255);

        // 3. Current-row marker (3 px, full width).
        int sel = table.getSelectionIndex();
        if (sel >= 0 && sel < count) {
            int y = (int) ((sel + 0.5) / count * h);
            gc.setBackground(rulerMarker);
            gc.fillRectangle(0, Math.max(0, y - 1), w, 3);
        }
    }

    /** Jump to the display row proportional to a click at pixel {@code clickY}. */
    private void onRulerClick(int clickY) {
        if (ruler == null || ruler.isDisposed()) return;
        int h = ruler.getBounds().height;
        int count = rulerStatuses.length;
        if (h <= 0 || count <= 0) return;
        int idx = (int) Math.floor((double) clickY / h * count);
        if (idx < 0) idx = 0;
        if (idx >= count) idx = count - 1;
        Table t = tableViewer.getTable();
        if (t.isDisposed()) return;
        t.setTopIndex(idx);
        t.select(idx);
        t.showSelection();
        redrawRuler();
    }

    // ================================================================== //
    //  Find                                                                //
    // ================================================================== //

    /**
     * Launch a background scan for the current find query.
     *
     * <p>Called on the UI thread.  The actual row scan runs inside an Eclipse
     * {@link Job} so a 1 M-row scan never blocks the workbench — identical
     * goal to the JetBrains port's {@code SwingWorker} approach.
     *
     * <p>The {@code findGen} counter guards against stale results: it is
     * incremented here (UI thread) before the job is submitted; the job
     * checks {@code gen != findGen} on every iteration and in the final
     * {@code asyncExec} callback so that a slow scan from a superseded query
     * silently discards its result rather than overwriting the newer one.
     *
     * <p>Matches are collected as ABSOLUTE row indices; {@link #revealFindMatch}
     * translates them to display indices for the current view mode.
     */
    private void runFind() {
        if (findText == null || findText.isDisposed()) return;

        // Capture query and toggle state on the UI thread before handing off.
        String  query    = findText.getText();
        boolean caseSens = findCaseAction  != null && findCaseAction.isChecked();
        boolean isRegex  = findRegexAction != null && findRegexAction.isChecked();

        // Bump the generation; any job already running with an older gen will
        // detect the mismatch and discard its result.
        final int gen = ++findGen;

        // Empty query or no data: clear state immediately on the UI thread.
        List<RowEntry> snap = entries;
        if (snap == null || query.isEmpty()) {
            findMatches = new int[0];
            findCursor  = -1;
            return;
        }

        Job findJob = new Job("Large File Compare: searching…") {
            @Override
            protected IStatus run(IProgressMonitor monitor) {
                List<Integer> hits = new ArrayList<>();
                if (isRegex) {
                    Pattern pat;
                    try {
                        int flags = caseSens ? 0 : Pattern.CASE_INSENSITIVE;
                        pat = Pattern.compile(query, flags);
                    } catch (PatternSyntaxException ex) {
                        // Invalid regex — deliver empty result so the UI stays consistent.
                        deliverFindResult(gen, new int[0]);
                        return Status.OK_STATUS;
                    }
                    for (int i = 0; i < snap.size(); i++) {
                        if (monitor.isCanceled() || gen != findGen) return Status.CANCEL_STATUS;
                        RowEntry re = snap.get(i);
                        String l = re.row().left()  != null ? re.row().left()  : "";
                        String r = re.row().right() != null ? re.row().right() : "";
                        if (pat.matcher(l).find() || pat.matcher(r).find()) hits.add(i);
                    }
                } else {
                    String needle = caseSens ? query : query.toLowerCase(Locale.ROOT);
                    for (int i = 0; i < snap.size(); i++) {
                        if (monitor.isCanceled() || gen != findGen) return Status.CANCEL_STATUS;
                        RowEntry re = snap.get(i);
                        String l = re.row().left()  != null ? re.row().left()  : "";
                        String r = re.row().right() != null ? re.row().right() : "";
                        String cl = caseSens ? l : l.toLowerCase(Locale.ROOT);
                        String cr = caseSens ? r : r.toLowerCase(Locale.ROOT);
                        if (cl.contains(needle) || cr.contains(needle)) hits.add(i);
                    }
                }
                deliverFindResult(gen, hits.stream().mapToInt(Integer::intValue).toArray());
                return Status.OK_STATUS;
            }
        };
        findJob.setSystem(true); // do not surface in the Eclipse Progress view
        findJob.schedule();
    }

    /**
     * Deliver find-scan results back to the UI thread via {@code asyncExec}.
     *
     * <p>Silently drops the result when {@code gen} no longer matches
     * {@code findGen} (a newer scan has superseded this one).  Must be
     * called from the background job thread, never from the UI thread.
     */
    private void deliverFindResult(int gen, int[] matches) {
        Display display = Display.getDefault();
        if (display == null || display.isDisposed()) return;
        display.asyncExec(() -> {
            if (gen != findGen || root == null || root.isDisposed()) return;
            findMatches = matches;
            // Reset to the first match on a new query (findCursor was set to -1
            // by the UI thread before the job was submitted).
            if (findCursor < 0 || findCursor >= findMatches.length) {
                findCursor = findMatches.length > 0 ? 0 : -1;
            }
            if (findCursor >= 0) revealFindMatch();
        });
    }

    /**
     * Move to the next or previous find match and reveal it.
     * Wraps around at both ends.
     */
    private void navigateFind(boolean forward) {
        if (findMatches.length == 0) {
            runFind(); // attempt fresh scan if no matches yet
            return;
        }
        if (forward) {
            findCursor = (findCursor + 1) % findMatches.length;
        } else {
            findCursor = (findCursor - 1 + findMatches.length) % findMatches.length;
        }
        revealFindMatch();
    }

    /**
     * Scroll to and select the row at the current find cursor.
     *
     * <p>{@link #findMatches} holds ABSOLUTE row indices; we translate through
     * the {@link DisplayRowModel} to a display index for the active view mode.
     * If the match is inside a collapsed fold, the fold is expanded first so
     * the row becomes directly reachable.
     */
    private void revealFindMatch() {
        if (findCursor < 0 || findCursor >= findMatches.length) return;
        if (tableViewer == null || tableViewer.getTable().isDisposed()) return;
        int abs = findMatches[findCursor];

        DisplayRowModel.Model m = displayModel;
        if (m != null && viewModeIndex == 2) {
            // Collapsed mode: if the match is hidden inside a fold, expand it.
            int disp = m.displayOf(abs);
            if (disp >= 0 && disp < m.count && m.foldAt(disp) != null) {
                DisplayRowModel.Fold fold = m.foldAt(disp);
                if (fold != null && abs >= fold.start && abs < fold.end) {
                    expandedFolds.add(fold.runStart);
                    rebuildDisplayModel();
                    m = displayModel;
                }
            }
        }

        int rowIdx = (m != null) ? m.displayOf(abs) : abs;
        Table t = tableViewer.getTable();
        t.setTopIndex(rowIdx);
        t.select(rowIdx);
        t.showSelection();
        redrawRuler();
    }

    // ================================================================== //
    //  Export                                                              //
    // ================================================================== //

    /** Prompt for a file and format, then write the diff on a background thread. */
    private void exportDiff() {
        List<RowEntry> snap = entries;
        if (snap == null || snap.isEmpty()) {
            MessageDialog.openInformation(getSite().getShell(),
                "Large File Compare",
                "Nothing to export — run a comparison first.");
            return;
        }

        // ---- Choose output file; format is determined by extension ---- //
        FileDialog fd = new FileDialog(getSite().getShell(), SWT.SAVE);
        fd.setText("Export Diff");
        fd.setFilterExtensions(new String[]{"*.csv", "*.txt", "*.*"});
        fd.setFilterNames(new String[]{
            "CSV files — Status, line numbers, left, right (*.csv)",
            "Plain text — git-style blocks (*.txt)",
            "All files"});
        fd.setFileName("diff-export.csv");
        String path = fd.open();
        if (path == null) return;

        boolean csv = path.toLowerCase().endsWith(".csv");

        // ---- Ask about scope ---- //
        boolean changesOnly = MessageDialog.openQuestion(getSite().getShell(),
            "Export scope",
            "Export changed rows only?\n\n"
            + "Yes → Added, Removed, and Changed rows only.\n"
            + "No  → All rows, including unchanged.");

        // ---- Write on a background Job ---- //
        final List<RowEntry> exportData   = snap;
        final String         targetPath   = path;
        final boolean        exportAsCsv  = csv;

        Job exportJob = new Job("Large File Compare: exporting…") {
            @Override
            protected IStatus run(IProgressMonitor monitor) {
                try {
                    writeDiffFile(targetPath, exportData, exportAsCsv, changesOnly);
                } catch (Exception ex) {
                    String msg = ex.getMessage() != null
                        ? ex.getMessage()
                        : ex.getClass().getSimpleName();
                    Display.getDefault().asyncExec(() -> {
                        if (root != null && !root.isDisposed()) {
                            MessageDialog.openError(getSite().getShell(),
                                "Export failed", msg);
                        }
                    });
                }
                return Status.OK_STATUS;
            }
        };
        exportJob.schedule();
    }

    // ================================================================== //
    //  Static export helpers (port of diffPanel.ts writeDiffFile)         //
    // ================================================================== //

    /**
     * Write {@code entries} to {@code path} in CSV or plain-text format.
     * Runs on a background thread; never accesses SWT.
     *
     * <p>CSV format: {@code Status,Left #,Right #,Left,Right\r\n} (RFC-4180).
     * Text format: git-style blocks with {@code +}/{@code -} markers.
     */
    private static void writeDiffFile(String path, List<RowEntry> entries,
                                      boolean csv, boolean changesOnly)
            throws IOException {
        try (BufferedWriter w = new BufferedWriter(
                new OutputStreamWriter(new FileOutputStream(path), StandardCharsets.UTF_8))) {
            if (csv) {
                w.write("Status,Left #,Right #,Left,Right\r\n");
            }
            for (RowEntry entry : entries) {
                DiffStatus status  = entry.row().status();
                if (changesOnly && status == DiffStatus.UNCHANGED) continue;

                int    leftNo  = entry.leftNo();
                int    rightNo = entry.rightNo();
                String left    = entry.row().left()  != null ? entry.row().left()  : "";
                String right   = entry.row().right() != null ? entry.row().right() : "";

                if (csv) {
                    w.write(status.name().toLowerCase(Locale.ROOT));
                    w.write(",");
                    w.write(leftNo  > 0 ? Integer.toString(leftNo)  : "");
                    w.write(",");
                    w.write(rightNo > 0 ? Integer.toString(rightNo) : "");
                    w.write(",");
                    w.write(csvField(left));
                    w.write(",");
                    w.write(csvField(right));
                    w.write("\r\n");
                } else {
                    w.write(textBlock(status, leftNo, rightNo, left, right));
                }
            }
        }
    }

    /**
     * RFC-4180 CSV field: wraps in double-quotes and escapes internal quotes
     * when the value contains a comma, double-quote, CR, or LF.
     */
    private static String csvField(String value) {
        if (value == null) return "";
        if (value.indexOf('"')  >= 0 || value.indexOf(',')  >= 0
                || value.indexOf('\r') >= 0 || value.indexOf('\n') >= 0) {
            return "\"" + value.replace("\"", "\"\"") + "\"";
        }
        return value;
    }

    /**
     * One human-readable text block for a row (git-style +/- markers).
     * Matches the {@code textBlock()} function in {@code diffPanel.ts}.
     */
    private static String textBlock(DiffStatus status,
                                    int leftNo, int rightNo,
                                    String left, String right) {
        String loc = "L" + (leftNo  > 0 ? leftNo  : "-")
                   + "  R" + (rightNo > 0 ? rightNo : "-");
        return switch (status) {
            case ADDED   -> "ADDED      " + loc + "\n  + " + right + "\n";
            case REMOVED -> "REMOVED    " + loc + "\n  - " + left  + "\n";
            case CHANGED -> "CHANGED    " + loc + "\n  - " + left
                                                + "\n  + " + right + "\n";
            default      -> "UNCHANGED  " + loc + "\n    " + left  + "\n";
        };
    }

    // ================================================================== //
    //  Toolbar state helpers                                               //
    // ================================================================== //

    /**
     * Enable or disable {@link #pairChangedAction} based on whether pairing
     * can have any effect given the current sort and mode selections.
     *
     * <p>{@code pairChanged} only affects positional, unsorted, whole-line diff:
     * <ul>
     *   <li><b>Sort active</b> — {@link DiffBackgroundJob} forces set mode;
     *       pairing is irrelevant.</li>
     *   <li><b>Key mode</b> ({@code lastDiffOpts.key != null}) — diff runs
     *       {@code diffByKey}; pairing is irrelevant.</li>
     *   <li><b>Set mode chosen in the dialog</b> — pairing is irrelevant.</li>
     * </ul>
     *
     * Mirrors {@code pairChangedCheck.isEnabled = isPositional && !hasSort && !keyMode}
     * in the JetBrains port ({@code DiffPanel.kt#updateToolbarState}).
     */
    private void updatePairChangedState() {
        if (pairChangedAction == null) return;
        boolean sortActive = sortComboIndex != 0;
        boolean keyMode    = lastDiffOpts.key  != null;
        boolean setMode    = "set".equals(lastDiffOpts.mode);
        pairChangedAction.setEnabled(!sortActive && !keyMode && !setMode);
        getViewSite().getActionBars().updateActionBars();
    }

    // ================================================================== //
    //  Sort ↔ combo-index mapping                                         //
    // ================================================================== //

    /** Map a {@link SortOptions} back to the sort combo index (0–4). */
    private static int sortOptionsToIndex(SortOptions opts) {
        if (opts == null) return 0;
        if (opts.mode == SortOptions.Mode.ALPHABETICAL
                && opts.direction == SortOptions.Direction.ASC)  return 1;
        if (opts.mode == SortOptions.Mode.ALPHABETICAL
                && opts.direction == SortOptions.Direction.DESC) return 2;
        if (opts.mode == SortOptions.Mode.NUMERIC
                && opts.direction == SortOptions.Direction.ASC)  return 3;
        if (opts.mode == SortOptions.Mode.NUMERIC
                && opts.direction == SortOptions.Direction.DESC) return 4;
        return 0;
    }

    /** Map a sort combo index (0–4) to a {@link SortOptions} (null = no sort). */
    private static SortOptions indexToSortOptions(int idx) {
        return switch (idx) {
            case 1 -> new SortOptions(SortOptions.Mode.ALPHABETICAL,
                                      SortOptions.Direction.ASC,  true, true, null);
            case 2 -> new SortOptions(SortOptions.Mode.ALPHABETICAL,
                                      SortOptions.Direction.DESC, true, true, null);
            case 3 -> new SortOptions(SortOptions.Mode.NUMERIC,
                                      SortOptions.Direction.ASC,  false, true, null);
            case 4 -> new SortOptions(SortOptions.Mode.NUMERIC,
                                      SortOptions.Direction.DESC, false, true, null);
            default -> null; // index 0 = Original: no sort
        };
    }

    // ================================================================== //
    //  Private UI helpers                                                  //
    // ================================================================== //

    /**
     * Attach a label provider to a new {@link TableViewerColumn}.
     *
     * <p>Line-number columns (0, 2) use a plain {@link ColumnLabelProvider};
     * text columns (1, 3) use a {@link TextCellLabelProvider} that owner-draws
     * the inline word-diff span for "changed" rows.
     *
     * @param colIndex 0 = left#, 1 = left text, 2 = right#, 3 = right text
     */
    private void addColumn(int colIndex, String title, int width, int style) {
        TableViewerColumn tvc = new TableViewerColumn(tableViewer, style);
        tvc.getColumn().setText(title);
        tvc.getColumn().setWidth(width);
        tvc.getColumn().setResizable(true);
        tvc.getColumn().setMoveable(false);

        if (colIndex == 1 || colIndex == 3) {
            tvc.setLabelProvider(new TextCellLabelProvider(colIndex == 1));
            return;
        }

        final boolean leftSide = (colIndex == 0);
        tvc.setLabelProvider(new ColumnLabelProvider() {
            @Override
            public String getText(Object element) {
                if (element instanceof DisplayRowModel.Fold) return "";
                if (!(element instanceof RowEntry e)) return "";
                int no = leftSide ? e.leftNo() : e.rightNo();
                return no > 0 ? Integer.toString(no) : "";
            }

            @Override
            public Color getBackground(Object element) {
                if (element instanceof DisplayRowModel.Fold) return colorFold;
                if (!(element instanceof RowEntry e)) return null;
                return statusColor(e.row().status());
            }

            @Override
            public Color getForeground(Object element) {
                return null; // inherit default foreground
            }

            @Override
            public String getToolTipText(Object element) {
                return null; // suppress default column-text tooltip
            }
        });
    }

    /**
     * Owner-draw label provider for the two text columns.  Renders the row text,
     * paints the status background, and — for "changed" rows — highlights the
     * single differing span computed by {@link WordDiff} (red on the left side,
     * green on the right).  Fold-marker rows render an "expand" hint.
     */
    private final class TextCellLabelProvider extends StyledCellLabelProvider {
        private final boolean leftSide;

        TextCellLabelProvider(boolean leftSide) {
            this.leftSide = leftSide;
        }

        @Override
        public void update(ViewerCell cell) {
            Object el = cell.getElement();

            if (el instanceof DisplayRowModel.Fold fold) {
                cell.setText(leftSide
                    ? "⋯ " + fold.count + " unchanged row"
                        + (fold.count == 1 ? "" : "s") + " — click to expand"
                    : "");
                cell.setStyleRanges(null);
                cell.setBackground(colorFold);
                super.update(cell);
                return;
            }

            if (!(el instanceof RowEntry e)) {
                cell.setText("");
                cell.setStyleRanges(null);
                cell.setBackground(null);
                super.update(cell);
                return;
            }

            DiffRow row = e.row();
            String text = leftSide
                ? (row.left()  != null ? row.left()  : "")
                : (row.right() != null ? row.right() : "");
            cell.setText(text);
            cell.setBackground(statusColor(row.status()));

            StyleRange[] ranges = null;
            if (row.status() == DiffStatus.CHANGED
                    && row.left() != null && row.right() != null) {
                WordDiff.InlineResult ir = WordDiff.compute(row.left(), row.right());
                if (ir != null) {
                    WordDiff.InlineSpan span = leftSide ? ir.left() : ir.right();
                    int len = span.end() - span.start();
                    if (len > 0 && span.start() >= 0 && span.end() <= text.length()) {
                        StyleRange sr = new StyleRange();
                        sr.start = span.start();
                        sr.length = len;
                        sr.background = leftSide ? colorWordDel : colorWordAdd;
                        ranges = new StyleRange[]{ sr };
                    }
                }
            }
            cell.setStyleRanges(ranges);
            super.update(cell);
        }
    }

    /** Map a {@link DiffStatus} to its highlight colour (null = no highlight). */
    private Color statusColor(DiffStatus status) {
        return switch (status) {
            case ADDED   -> colorAdded;
            case REMOVED -> colorRemoved;
            case CHANGED -> colorChanged;
            default      -> null; // UNCHANGED: use default table background
        };
    }

    private static void safeDispose(Color c) {
        if (c != null && !c.isDisposed()) c.dispose();
    }
}

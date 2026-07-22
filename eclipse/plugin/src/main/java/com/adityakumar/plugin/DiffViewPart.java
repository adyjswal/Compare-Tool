package com.adityakumar.plugin;

import com.adityakumar.engine.DiffResult;
import com.adityakumar.engine.DiffRow;
import com.adityakumar.engine.DiffStatus;
import com.adityakumar.engine.DiffSummary;

import org.eclipse.jface.viewers.ColumnLabelProvider;
import org.eclipse.jface.viewers.ILazyContentProvider;
import org.eclipse.jface.viewers.TableViewer;
import org.eclipse.jface.viewers.TableViewerColumn;
import org.eclipse.jface.viewers.Viewer;
import org.eclipse.swt.SWT;
import org.eclipse.swt.graphics.Color;
import org.eclipse.swt.layout.GridData;
import org.eclipse.swt.layout.GridLayout;
import org.eclipse.swt.widgets.Composite;
import org.eclipse.swt.widgets.Display;
import org.eclipse.swt.widgets.Label;
import org.eclipse.swt.widgets.Table;
import org.eclipse.ui.part.ViewPart;

import java.util.ArrayList;
import java.util.List;

/**
 * Side-by-side diff view for Large File Compare.
 *
 * <p>Uses an SWT {@code VIRTUAL} TableViewer so Eclipse only materialises
 * TableItem widgets for the rows that are <em>currently visible</em> in the
 * viewport.  For a 1 M-row result only ~50-100 TableItem objects ever exist at
 * once; the engine's in-memory {@code List<DiffRow>} holds the data and is
 * accessed at O(1) via {@link RowEntry} index.
 *
 * <p>Layout: four columns — left-line# | left-text | right-line# | right-text.
 * Per-row background colour encodes diff status:
 * <ul>
 *   <li>UNCHANGED – default (no highlight)
 *   <li>ADDED     – pale green
 *   <li>REMOVED   – pale red
 *   <li>CHANGED   – pale yellow
 * </ul>
 */
public class DiffViewPart extends ViewPart {

    public static final String VIEW_ID = "com.adityakumar.largefilecompare.view";

    // ------------------------------------------------------------------ //
    //  UI fields                                                           //
    // ------------------------------------------------------------------ //

    private Composite root;
    private Label summaryLabel;
    private TableViewer tableViewer;

    /** Palette — allocated in createPartControl, disposed with the Table widget. */
    private Color colorAdded;
    private Color colorRemoved;
    private Color colorChanged;

    // ------------------------------------------------------------------ //
    //  Data model                                                          //
    // ------------------------------------------------------------------ //

    /**
     * A single display row: the underlying diff row plus its precomputed
     * left/right 1-based line numbers (0 = no text on that side).
     *
     * <p>Stored as a flat ArrayList so the {@link ILazyContentProvider} can
     * reach any row in O(1) without scanning the full result list.
     */
    private record RowEntry(DiffRow row, int leftNo, int rightNo) {}

    /** Null until the first {@link #displayResult} call. */
    private List<RowEntry> entries;

    // ================================================================== //
    //  ViewPart lifecycle                                                  //
    // ================================================================== //

    @Override
    public void createPartControl(Composite parent) {
        root = new Composite(parent, SWT.NONE);
        root.setLayout(new GridLayout(1, false));

        // ---- summary bar ----
        summaryLabel = new Label(root, SWT.NONE);
        summaryLabel.setText(
            "Large File Compare — use Large File Compare > Compare Two Files… to start.");
        summaryLabel.setLayoutData(new GridData(SWT.FILL, SWT.CENTER, true, false));

        // ---- status palette ----
        Display display = parent.getDisplay();
        colorAdded   = new Color(display, 214, 255, 214); // pale green
        colorRemoved = new Color(display, 255, 210, 210); // pale red
        colorChanged = new Color(display, 255, 255, 200); // pale yellow

        // ---- virtual table ----
        //
        // SWT.VIRTUAL: the table only calls SWT.SetData (→ updateElement) for
        // rows that are actually in the viewport.  At 1 M rows only ~80 TableItem
        // objects exist at any one time regardless of result size.
        Table table = new Table(root,
                SWT.VIRTUAL | SWT.BORDER | SWT.FULL_SELECTION
                | SWT.MULTI | SWT.V_SCROLL | SWT.H_SCROLL);
        table.setHeaderVisible(true);
        table.setLinesVisible(false);
        table.setLayoutData(new GridData(SWT.FILL, SWT.FILL, true, true));

        tableViewer = new TableViewer(table);

        // Four columns ------------------------------------------------- //
        addColumn(0, "#",      45,  SWT.RIGHT); // left line number
        addColumn(1, "Left",  600,  SWT.LEFT);  // left text
        addColumn(2, "#",      45,  SWT.RIGHT); // right line number
        addColumn(3, "Right", 600,  SWT.LEFT);  // right text

        // Lazy content provider: only materialises data for visible rows --//
        tableViewer.setContentProvider(new ILazyContentProvider() {
            @Override
            public void updateElement(int index) {
                List<RowEntry> snap = entries;
                if (snap != null && index >= 0 && index < snap.size()) {
                    tableViewer.replace(snap.get(index), index);
                }
            }
            @Override public void dispose() {}
            @Override public void inputChanged(Viewer v, Object oldInput, Object newInput) {}
        });

        // Seed with an empty input so the ContentProvider is wired up.
        tableViewer.setInput(new Object());
        tableViewer.setItemCount(0);

        // Dispose colours when the table widget is destroyed.
        table.addDisposeListener(e -> {
            safeDispose(colorAdded);
            safeDispose(colorRemoved);
            safeDispose(colorChanged);
        });
    }

    @Override
    public void setFocus() {
        if (tableViewer != null && !tableViewer.getTable().isDisposed()) {
            tableViewer.getTable().setFocus();
        }
    }

    // ================================================================== //
    //  Public API called from the background job                          //
    // ================================================================== //

    /**
     * Display a completed diff result.  Safe to call from any thread.
     *
     * <p>Precomputes 1-based line numbers for every row (O(n) single pass)
     * then hands the entries list to the virtual table and refreshes only
     * the visible window.
     */
    public void displayResult(DiffResult result) {
        if (root == null || root.isDisposed()) return;
        root.getDisplay().asyncExec(() -> {
            if (root.isDisposed()) return;

            // Build the flat RowEntry list with precomputed line numbers.
            List<DiffRow> rows = result.rows();
            List<RowEntry> newEntries = new ArrayList<>(rows.size());
            int lNo = 1, rNo = 1;
            for (DiffRow row : rows) {
                int leftNo  = (row.left()  != null) ? lNo  : 0;
                int rightNo = (row.right() != null) ? rNo  : 0;
                newEntries.add(new RowEntry(row, leftNo, rightNo));
                if (row.left()  != null) lNo++;
                if (row.right() != null) rNo++;
            }
            entries = newEntries;

            // Update the summary bar.
            DiffSummary s = result.summary();
            summaryLabel.setText(String.format(
                "Total: %,d rows  │  Unchanged: %,d  │  Added: %,d  "
                + "│  Removed: %,d  │  Changed: %,d",
                s.total(), s.unchanged(), s.added(), s.removed(), s.changed()));

            // Swap the table data.  setItemCount clears all cached TableItem
            // data; visible rows will immediately re-request via updateElement.
            tableViewer.setItemCount(0);          // clear stale items first
            tableViewer.setItemCount(entries.size());

            root.layout(true, true);
        });
    }

    /** Display an error message.  Safe to call from any thread. */
    public void displayError(String message) {
        if (root == null || root.isDisposed()) return;
        root.getDisplay().asyncExec(() -> {
            if (root.isDisposed()) return;
            entries = null;
            tableViewer.setItemCount(0);
            summaryLabel.setText("Error: " + message);
            root.layout(true);
        });
    }

    // ================================================================== //
    //  Private helpers                                                     //
    // ================================================================== //

    /**
     * Attach a {@link ColumnLabelProvider} to a new {@link TableViewerColumn}.
     *
     * @param colIndex 0 = left line#, 1 = left text, 2 = right line#, 3 = right text
     */
    private void addColumn(int colIndex, String title, int width, int style) {
        TableViewerColumn tvc = new TableViewerColumn(tableViewer, style);
        tvc.getColumn().setText(title);
        tvc.getColumn().setWidth(width);
        tvc.getColumn().setResizable(true);
        tvc.getColumn().setMoveable(false);

        tvc.setLabelProvider(new ColumnLabelProvider() {

            @Override
            public String getText(Object element) {
                if (!(element instanceof RowEntry e)) return "";
                return switch (colIndex) {
                    case 0 -> (e.leftNo()  > 0) ? Integer.toString(e.leftNo())  : "";
                    case 1 -> (e.row().left()  != null) ? e.row().left()  : "";
                    case 2 -> (e.rightNo() > 0) ? Integer.toString(e.rightNo()) : "";
                    case 3 -> (e.row().right() != null) ? e.row().right() : "";
                    default -> "";
                };
            }

            @Override
            public Color getBackground(Object element) {
                if (!(element instanceof RowEntry e)) return null;
                return statusColor(e.row().status());
            }

            @Override
            public Color getForeground(Object element) {
                return null; // inherit default foreground
            }

            /** Suppress the default tooltip which would show the column text. */
            @Override
            public String getToolTipText(Object element) {
                return null;
            }
        });
    }

    /** Map a {@link DiffStatus} to its highlight colour (null = no highlight). */
    private Color statusColor(DiffStatus status) {
        return switch (status) {
            case ADDED    -> colorAdded;
            case REMOVED  -> colorRemoved;
            case CHANGED  -> colorChanged;
            default       -> null; // UNCHANGED: use the default table background
        };
    }

    private static void safeDispose(Color c) {
        if (c != null && !c.isDisposed()) c.dispose();
    }
}

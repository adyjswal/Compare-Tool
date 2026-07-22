package com.adityakumar.plugin;

import com.adityakumar.engine.Differ;
import com.adityakumar.engine.DiffOptions;
import com.adityakumar.engine.DiffResult;
import com.adityakumar.engine.Reader;
import com.adityakumar.engine.Sorter;
import com.adityakumar.engine.SortOptions;

import org.eclipse.core.runtime.IProgressMonitor;
import org.eclipse.core.runtime.IStatus;
import org.eclipse.core.runtime.Status;
import org.eclipse.core.runtime.jobs.Job;

import java.util.List;
import java.util.function.Consumer;

/**
 * Eclipse background {@link Job} that reads both files and runs the diff engine.
 *
 * <p>Runs on the Eclipse job thread pool — never blocks the UI thread.
 * Results are delivered via callbacks which must dispatch to the UI thread
 * themselves (see {@link DiffViewPart#displayResult}).
 *
 * <p><b>Sort precedence:</b> key-column &gt; sort &gt; positional.
 * When {@code sortOptions} is non-null <em>and</em> no key column is configured,
 * both line lists are sorted before diffing and the diff mode is forced to
 * {@code "set"} (sorted lines should never be compared positionally).
 * When a key column is active, sorting is silently ignored — key matching
 * already provides the correct record alignment.
 *
 * <p><b>Memory note:</b> {@link Reader#readLines} loads the whole file into an
 * {@code ArrayList<String>}.  For the target file sizes (up to ~2 M lines)
 * this is the same invariant as the VS Code worker; random access is required
 * by the diff engine so streaming wouldn't help here.
 */
public class DiffBackgroundJob extends Job {

    private final String leftPath;
    private final String rightPath;
    private final DiffOptions options;
    private final SortOptions sortOptions;   // null = no sort
    private final Consumer<DiffResult> onResult;
    private final Consumer<String>     onError;

    /**
     * @param sortOptions may be {@code null} (no sort). Ignored when
     *                    {@code options.key} is non-null (key mode takes precedence).
     */
    public DiffBackgroundJob(String leftPath, String rightPath,
                             DiffOptions options, SortOptions sortOptions,
                             Consumer<DiffResult> onResult, Consumer<String> onError) {
        super("Large File Compare: comparing…");
        this.leftPath    = leftPath;
        this.rightPath   = rightPath;
        this.options     = options;
        this.sortOptions = sortOptions;
        this.onResult    = onResult;
        this.onError     = onError;
    }

    @Override
    protected IStatus run(IProgressMonitor monitor) {
        monitor.beginTask("Comparing files", 4);
        try {
            // Binary check
            if (Reader.isProbablyBinary(leftPath) || Reader.isProbablyBinary(rightPath)) {
                onError.accept("Binary file detected — only text files can be compared.");
                return Status.OK_STATUS;
            }
            monitor.worked(1);
            if (monitor.isCanceled()) return Status.CANCEL_STATUS;

            List<String> leftLines  = Reader.readLines(leftPath);
            monitor.worked(1);
            if (monitor.isCanceled()) return Status.CANCEL_STATUS;

            List<String> rightLines = Reader.readLines(rightPath);
            monitor.worked(1);
            if (monitor.isCanceled()) return Status.CANCEL_STATUS;

            // Apply sort when requested AND not in key-column mode.
            // Key precedence: key > sort > positional.
            DiffOptions effectiveOptions = options;
            if (sortOptions != null && options.key == null) {
                leftLines  = Sorter.sortLines(leftLines, sortOptions);
                rightLines = Sorter.sortLines(rightLines, sortOptions);
                // Sorted lines must use "set" mode — positional pairing of sorted
                // data produces meaningless changed rows.
                effectiveOptions = new DiffOptions(
                        "set", null,
                        options.trim, options.caseInsensitive, options.pairChanged);
            }

            DiffResult result = Differ.diffLines(leftLines, rightLines, effectiveOptions);
            monitor.worked(1);
            onResult.accept(result);

        } catch (Exception e) {
            onError.accept(e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName());
        } finally {
            monitor.done();
        }
        return Status.OK_STATUS;
    }
}

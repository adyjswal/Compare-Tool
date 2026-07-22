package com.adityakumar.plugin;

import com.adityakumar.engine.Differ;
import com.adityakumar.engine.DiffOptions;
import com.adityakumar.engine.DiffResult;
import com.adityakumar.engine.Reader;

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
 * <p><b>Memory note:</b> {@link Reader#readLines} uses
 * {@code Files.readAllLines()}, which loads the whole file into an
 * {@code ArrayList<String>}.  For the target file sizes (up to ~2 M lines)
 * this keeps both line arrays in the JVM heap for the duration of the diff —
 * the same invariant as the VS Code worker.  A streaming reader would produce
 * the same heap footprint because the diff engine needs random access to both
 * arrays anyway, so there is no benefit to incremental reading here.
 */
public class DiffBackgroundJob extends Job {

    private final String leftPath;
    private final String rightPath;
    private final DiffOptions options;
    private final Consumer<DiffResult> onResult;
    private final Consumer<String>     onError;

    public DiffBackgroundJob(String leftPath, String rightPath, DiffOptions options,
                             Consumer<DiffResult> onResult, Consumer<String> onError) {
        super("Large File Compare: comparing…");
        this.leftPath  = leftPath;
        this.rightPath = rightPath;
        this.options   = options;
        this.onResult  = onResult;
        this.onError   = onError;
    }

    @Override
    protected IStatus run(IProgressMonitor monitor) {
        monitor.beginTask("Comparing files", 3);
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

            DiffResult result = Differ.diffLines(leftLines, rightLines, options);
            onResult.accept(result);

        } catch (Exception e) {
            onError.accept(e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName());
        } finally {
            monitor.done();
        }
        return Status.OK_STATUS;
    }
}

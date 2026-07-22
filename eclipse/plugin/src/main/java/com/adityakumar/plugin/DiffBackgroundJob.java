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

public class DiffBackgroundJob extends Job {
    private final String leftPath;
    private final String rightPath;
    private final Consumer<DiffResult> onResult;
    private final Consumer<String> onError;

    public DiffBackgroundJob(String leftPath, String rightPath,
                             Consumer<DiffResult> onResult, Consumer<String> onError) {
        super("Large File Compare: comparing…");
        this.leftPath = leftPath; this.rightPath = rightPath;
        this.onResult = onResult; this.onError = onError;
    }

    @Override
    protected IStatus run(IProgressMonitor monitor) {
        monitor.beginTask("Comparing files", 3);
        try {
            if (Reader.isProbablyBinary(leftPath) || Reader.isProbablyBinary(rightPath)) {
                onError.accept("Binary file detected — only text files can be compared.");
                return Status.OK_STATUS;
            }
            monitor.worked(1);
            monitor.checkCanceled();

            List<String> leftLines  = Reader.readLines(leftPath);
            monitor.worked(1);
            monitor.checkCanceled();

            List<String> rightLines = Reader.readLines(rightPath);
            monitor.worked(1);
            monitor.checkCanceled();

            DiffResult result = Differ.diffLines(leftLines, rightLines, new DiffOptions());
            onResult.accept(result);

        } catch (org.eclipse.core.runtime.OperationCanceledException e) {
            return Status.CANCEL_STATUS;
        } catch (Exception e) {
            onError.accept(e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName());
        } finally {
            monitor.done();
        }
        return Status.OK_STATUS;
    }
}

package com.adityakumar.engine;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Inline word-level diff computation for "changed" rows.
 *
 * <p>Faithfully ports the VS Code DiffList.tsx {@code computeInline()} function.
 * The algorithm is <em>not</em> Myers/LCS — it is a single-span approach:
 * <ol>
 *   <li>Tokenize both sides with the regex {@code \w+|\s+|[^\w\s]+}.</li>
 *   <li>Find the longest common token prefix.</li>
 *   <li>Find the longest common token suffix (constrained to not overlap the prefix).</li>
 *   <li>Convert the remaining middle token range to character offsets.</li>
 * </ol>
 *
 * <p>The result is at most <em>one</em> highlighted span per side covering the
 * entire differing middle segment. Returns {@code null} when the combined line
 * length exceeds {@value #INLINE_MAX_CHARS} or when the lines are token-identical.
 *
 * <p>This class is pure Java with no SWT/UI dependencies; it is fully
 * unit-testable without a running Eclipse workbench.
 */
public final class WordDiff {

    /** Skip inline highlighting when both lines together exceed this many characters. */
    public static final int INLINE_MAX_CHARS = 20_000;

    /**
     * One pair of character-offset spans, one per side of a changed row.
     *
     * <p>{@code start} is inclusive; {@code end} is exclusive.
     * Both offsets are into the raw (original) line string.
     * When {@code start == end} the span is empty and no highlight is applied.
     */
    public record InlineSpan(int start, int end) {}

    /**
     * The result of an inline diff computation.
     *
     * @param left  span to highlight on the left  (removed/old) side
     * @param right span to highlight on the right (added/new)   side
     */
    public record InlineResult(InlineSpan left, InlineSpan right) {}

    // Regex identical to the JS: /\w+|\s+|[^\w\s]+/g
    // Java \w is ASCII-only [A-Za-z0-9_] — same as JS \w for typical log/CSV/SQL content.
    private static final Pattern TOKEN_PATTERN =
            Pattern.compile("\\w+|\\s+|[^\\w\\s]+");

    private WordDiff() {}   // static utility class

    /**
     * Compute an inline word-level diff between the two raw line strings.
     *
     * @param left  the old/left line text (never {@code null})
     * @param right the new/right line text (never {@code null})
     * @return an {@link InlineResult} with character spans, or {@code null}
     *         if the lines are too long or token-identical.
     */
    public static InlineResult compute(String left, String right) {
        // Guard: skip when combined length exceeds the threshold.
        if (left.length() + right.length() > INLINE_MAX_CHARS) return null;

        String[] a = tokenize(left);
        String[] b = tokenize(right);

        // Step 2: longest common token prefix.
        int prefix = 0;
        int maxPrefix = Math.min(a.length, b.length);
        while (prefix < maxPrefix && a[prefix].equals(b[prefix])) {
            prefix++;
        }

        // Step 3: longest common token suffix (must not overlap the prefix).
        int suffix = 0;
        int maxSuffix = maxPrefix - prefix;
        while (suffix < maxSuffix
                && a[a.length - 1 - suffix].equals(b[b.length - 1 - suffix])) {
            suffix++;
        }

        // Step 4: convert token index ranges to character offsets.
        int[] leftSpan  = changedRange(a, prefix, a.length - suffix);
        int[] rightSpan = changedRange(b, prefix, b.length - suffix);

        // If the span is empty (lines are token-identical) return null.
        if (leftSpan[0] == leftSpan[1] && rightSpan[0] == rightSpan[1]) return null;

        return new InlineResult(
                new InlineSpan(leftSpan[0],  leftSpan[1]),
                new InlineSpan(rightSpan[0], rightSpan[1]));
    }

    /**
     * Tokenize {@code text} using the regex {@code \w+|\s+|[^\w\s]+}.
     *
     * <p>Tokens are non-overlapping and exhaustive — they concatenate back to
     * the original string. An empty input returns an empty array.
     *
     * @param text the raw line text to split
     * @return array of token strings (may be empty, never {@code null})
     */
    public static String[] tokenize(String text) {
        if (text.isEmpty()) return new String[0];
        List<String> tokens = new ArrayList<>();
        Matcher m = TOKEN_PATTERN.matcher(text);
        while (m.find()) {
            tokens.add(m.group());
        }
        return tokens.toArray(new String[0]);
    }

    /**
     * Convert a half-open token index range {@code [midStart, midEnd)} to
     * character offsets {@code [start, end]} in the original string.
     *
     * <p>Port of {@code changedRange()} from DiffList.tsx (lines 946-961).
     *
     * @param tokens   the token array for one side
     * @param midStart first token index of the changed span (= prefix count)
     * @param midEnd   exclusive end token index of the changed span
     *                 (= {@code tokens.length - suffix})
     * @return {@code int[2]}: {@code [inclusive-start, exclusive-end]} into the
     *         original line string
     */
    static int[] changedRange(String[] tokens, int midStart, int midEnd) {
        int start = 0;
        for (int i = 0; i < midStart; i++) {
            start += tokens[i].length();
        }
        int end = start;
        for (int i = midStart; i < midEnd; i++) {
            end += tokens[i].length();
        }
        return new int[]{start, end};
    }
}

package com.adityakumar.engine

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class DifferTest {
    @Test fun `unchanged lines are unchanged`() {
        val r = Differ.diffLines(listOf("a","b","c"), listOf("a","b","c"))
        assertEquals(3, r.summary.unchanged)
        assertEquals(0, r.summary.added + r.summary.removed + r.summary.changed)
    }
    @Test fun `added line detected`() {
        val r = Differ.diffLines(listOf("a","b"), listOf("a","b","c"))
        assertEquals(1, r.summary.added); assertEquals(0, r.summary.removed)
    }
    @Test fun `removed line detected`() {
        val r = Differ.diffLines(listOf("a","b","c"), listOf("a","c"))
        assertEquals(1, r.summary.removed); assertEquals(0, r.summary.added)
    }
    @Test fun `key mode matches by column`() {
        val key = ColumnSpec(",", 1)
        val r = Differ.diffLines(listOf("1,alice","2,bob"), listOf("1,alicia","2,bob","3,carol"), DiffOptions(key=key))
        assertEquals(1, r.summary.changed)   // alice → alicia
        assertEquals(1, r.summary.unchanged) // bob
        assertEquals(1, r.summary.added)     // carol
    }
    @Test fun `empty vs non-empty`() {
        val r = Differ.diffLines(emptyList(), listOf("a","b"))
        assertEquals(2, r.summary.added); assertEquals(0, r.summary.removed)
    }
    @Test fun `trim option treats trimmed lines as equal`() {
        val r = Differ.diffLines(listOf("hello "), listOf("hello"), DiffOptions(trim=true))
        assertEquals(1, r.summary.unchanged)
    }
}

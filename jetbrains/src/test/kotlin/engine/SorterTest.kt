package com.adityakumar.engine

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class SorterTest {
    @Test fun `alphabetical ascending`() {
        val r = Sorter.sortLines(listOf("c","a","b"), SortOptions())
        assertEquals(listOf("a","b","c"), r)
    }
    @Test fun `alphabetical descending`() {
        val r = Sorter.sortLines(listOf("a","c","b"), SortOptions(direction=SortDirection.DESC))
        assertEquals(listOf("c","b","a"), r)
    }
    @Test fun `numeric sort`() {
        val r = Sorter.sortLines(listOf("10","2","1"), SortOptions(mode=SortMode.NUMERIC))
        assertEquals(listOf("1","2","10"), r)
    }
    @Test fun `column extraction`() {
        val col = ColumnSpec(",", 2)
        val r = Sorter.sortLines(listOf("b,2","a,1","c,3"), SortOptions(column=col))
        assertEquals(listOf("a,1","b,2","c,3"), r)
    }
    @Test fun `case insensitive`() {
        val r = Sorter.sortLines(listOf("B","a","C"), SortOptions(caseInsensitive=true))
        assertEquals(listOf("a","B","C"), r)
    }
}

package com.adityakumar.engine

import java.io.FileInputStream
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Paths

object Reader {
    /** Read a text file into a list of lines. A single trailing empty line is dropped. */
    fun readLines(path: String): List<String> {
        val lines = Files.readAllLines(Paths.get(path), StandardCharsets.UTF_8)
        // Drop a single trailing empty string (matches TS engine behaviour for files ending in newline)
        return if (lines.isNotEmpty() && lines.last().isEmpty()) lines.dropLast(1) else lines
    }

    /** Heuristic binary check: a NUL byte in the first ~8KB is a strong signal of binary content. */
    fun isProbablyBinary(path: String): Boolean {
        val sniffBytes = 8000
        FileInputStream(path).use { fis ->
            val buf = ByteArray(sniffBytes)
            val read = fis.read(buf)
            for (i in 0 until read) {
                if (buf[i] == 0.toByte()) return true
            }
        }
        return false
    }
}

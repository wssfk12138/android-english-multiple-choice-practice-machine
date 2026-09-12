package com.wssfk.englishpracticemachine;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.io.FileOutputStream;

import org.junit.Test;

public class AppUpdaterPluginTest {
    @Test
    public void readsCatalogSizesRegardlessOfJsonIntegerRepresentation() {
        assertEquals(Long.valueOf(428_880_106L), AppUpdaterPlugin.readWholeNumber(428_880_106));
        assertEquals(Long.valueOf(844_697_670L), AppUpdaterPlugin.readWholeNumber(844_697_670));
        assertEquals(Long.valueOf(2_147_483_648L), AppUpdaterPlugin.readWholeNumber(2_147_483_648L));
        assertEquals(Long.valueOf(428_880_106L), AppUpdaterPlugin.readWholeNumber(428_880_106D));
    }

    @Test
    public void rejectsMissingFractionalAndNonFiniteSizes() {
        assertNull(AppUpdaterPlugin.readWholeNumber(null));
        assertNull(AppUpdaterPlugin.readWholeNumber(1.5D));
        assertNull(AppUpdaterPlugin.readWholeNumber(Double.NaN));
        assertNull(AppUpdaterPlugin.readWholeNumber("428880106"));
    }

    @Test
    public void reservesSixtyFourMibBeyondTheDeclaredQuestionBankSize() {
        long reserve = 64L * 1024L * 1024L;
        long twoGiB = 2L * 1024L * 1024L * 1024L;
        assertTrue(AppUpdaterPlugin.hasQuestionBankDownloadSpace(twoGiB + reserve, twoGiB));
        assertFalse(AppUpdaterPlugin.hasQuestionBankDownloadSpace(twoGiB + reserve - 1, twoGiB));
        assertFalse(AppUpdaterPlugin.hasQuestionBankDownloadSpace(twoGiB + reserve + 1, twoGiB + 1));
    }

    @Test
    public void cleansPartialDownloadFiles() throws Exception {
        File partial = File.createTempFile("question-bank-", ".part");
        try (FileOutputStream output = new FileOutputStream(partial)) {
            output.write(new byte[] {1, 2, 3});
        }
        assertTrue(partial.isFile());
        assertTrue(AppUpdaterPlugin.cleanupTemporaryFile(partial));
        assertFalse(partial.exists());
    }
}

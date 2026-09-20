package com.wssfk.englishpracticemachine;

import static org.junit.Assert.*;
import org.junit.Test;
import org.junit.Rule;
import org.junit.rules.TemporaryFolder;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.zip.*;

public class EsqStageTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();

    private File archive() throws Exception {
        File file = temporary.newFile();
        try (ZipOutputStream zip = new ZipOutputStream(new FileOutputStream(file))) {
            add(zip, "manifest.json", "{\"packageId\":\"test.bank\",\"contentVersion\":\"1\",\"papers\":[{\"paperKey\":\"p1\",\"path\":\"paper.json\",\"answerPath\":\"answer.json\"}]}");
            add(zip, "paper.json", "{\"paperKey\":\"p1\",\"year\":2026,\"units\":[{\"unitKey\":\"u1\",\"questions\":[{\"questionKey\":\"q1\",\"number\":1,\"stem\":\"retained\"},{\"questionKey\":\"q2\",\"number\":2}]}]}");
            add(zip, "answer.json", "{\"paperKey\":\"p1\",\"answers\":{\"q1\":{\"correctOption\":\"A\"},\"q2\":{\"correctOption\":\"B\"}}}");
        }
        return file;
    }
    private static void add(ZipOutputStream zip, String name, String value) throws Exception {
        zip.putNextEntry(new ZipEntry(name));
        zip.write(value.getBytes(StandardCharsets.UTF_8));
        zip.closeEntry();
    }

    @Test public void stagedRecordsSurviveRestartWithoutAggregatingPaper() throws Exception {
        File root = temporary.newFolder();
        JSONObject summary = EsqStage.stage(archive(), root);
        String task = summary.getString("stageId");
        assertFalse(summary.toString().contains("retained"));
        assertEquals(2, summary.getJSONArray("papers").getJSONObject(0).getInt("questionCount"));
        JSONObject unit = EsqStage.read(root, task, 0, 0, -1);
        assertEquals(2, unit.getJSONArray("questions").length());
        assertFalse(unit.toString().contains("retained"));
        JSONObject question = EsqStage.read(root, task, 0, 0, 0);
        assertEquals("retained", question.getJSONObject("question").getString("stem"));
        assertEquals("A", question.getJSONObject("answer").getString("correctOption"));
        assertEquals(task, EsqStage.resume(root, task).getString("stageId"));
    }

    @Test public void invalidTaskCannotEscapePrivateDirectory() throws Exception {
        assertThrows(SecurityException.class, () -> EsqStage.resume(temporary.newFolder(), "../escape"));
    }

    @Test public void retainedArchiveRepairsInterruptedParsing() throws Exception {
        File root = temporary.newFolder();
        JSONObject result = EsqStage.stage(archive(), root);
        File ready = new File(root, "esq-tasks/" + result.getString("stageId") + "/ready.json");
        assertTrue(ready.delete());
        assertEquals(2, EsqStage.resume(root, result.getString("stageId")).getJSONArray("papers").getJSONObject(0).getInt("questionCount"));
    }

    @Test public void retainedArchiveRepairsMissingQuestion() throws Exception {
        File root = temporary.newFolder();
        String id = EsqStage.stage(archive(), root).getString("stageId");
        assertTrue(new File(root, "esq-tasks/" + id + "/p0/u0/q0.json").delete());
        EsqStage.resume(root, id);
        assertEquals("retained", EsqStage.read(root, id, 0, 0, 0).getJSONObject("question").getString("stem"));
    }

    @Test public void receiptAcknowledgementRetainsRetryData() throws Exception {
        File root = temporary.newFolder();
        File source = archive();
        JSONObject summary;
        try (InputStream input = new FileInputStream(source)) {
            summary = EsqStage.receive(input, source.length(), root, new JSONObject().put("filename", "test.esq").put("profileId", 1));
        }
        assertEquals(1, EsqStage.pending(root).length());
        String id = summary.getString("stageId");
        EsqStage.acknowledge(root, id);
        assertEquals(0, EsqStage.pending(root).length());
        assertEquals(id, EsqStage.resume(root, id).getString("stageId"));
    }

    @Test public void realCetArchivesWithBoundedHeap() throws Exception {
        String path = System.getenv("ESQ_FIXTURES");
        org.junit.Assume.assumeTrue("Optional downloaded CET fixtures", path != null);
        for (String name : new String[]{"cet4", "cet6"}) {
            String output = System.getenv("ESQ_STAGE_OUTPUT");
            File root = output == null ? temporary.newFolder() : new File(output, name);
            java.nio.file.Files.createDirectories(root.toPath());
            File input = new File(path, name + "-complete-v1.2.0.esq");
            long start = System.nanoTime();
            JSONObject summary = EsqStage.stage(input, root);
            int questions = 0;
            for (int p = 0; p < summary.getJSONArray("papers").length(); p++) questions += summary.getJSONArray("papers").getJSONObject(p).getInt("questionCount");
            assertTrue(questions > 1000);
            assertEquals(summary.getString("stageId"), EsqStage.resume(root, summary.getString("stageId")).getString("stageId"));
            System.out.println("REAL_ESQ " + name + " bytes=" + input.length() + " papers=" + summary.getJSONArray("papers").length() + " questions=" + questions + " heap=" + Runtime.getRuntime().maxMemory() + " elapsedMs=" + (System.nanoTime() - start) / 1000000);
        }
    }

    @Test public void nearTwoGiBStoredAssetWithBoundedHeap() throws Exception {
        org.junit.Assume.assumeTrue("Optional capacity fixture", "1".equals(System.getenv("ESQ_CAPACITY_TEST")));
        long size = EsqArchive.MAX_ARCHIVE_BYTES - 65536;
        byte[] buffer = new byte[65536];
        CRC32 crc = new CRC32();
        java.security.MessageDigest digest = java.security.MessageDigest.getInstance("SHA-256");
        for (long remaining = size; remaining > 0;) {
            int n = (int) Math.min(buffer.length, remaining);
            crc.update(buffer, 0, n); digest.update(buffer, 0, n); remaining -= n;
        }
        String hash = java.util.HexFormat.of().formatHex(digest.digest());
        File input = temporary.newFile();
        try (ZipOutputStream zip = new ZipOutputStream(new FileOutputStream(input)); ZipFile small = new ZipFile(archive())) {
            java.util.Enumeration<? extends ZipEntry> entries = small.entries();
            while (entries.hasMoreElements()) {
                ZipEntry entry = entries.nextElement();
                zip.putNextEntry(new ZipEntry(entry.getName()));
                try (InputStream stream = small.getInputStream(entry)) { stream.transferTo(zip); }
                zip.closeEntry();
            }
            add(zip, "assets/index.json", new JSONObject().put("assets", new org.json.JSONArray().put(new JSONObject()
                .put("assetId", "capacity").put("path", "assets/capacity.bin").put("size", size).put("sha256", hash))).toString());
            ZipEntry asset = new ZipEntry("assets/capacity.bin");
            asset.setMethod(ZipEntry.STORED); asset.setSize(size); asset.setCompressedSize(size); asset.setCrc(crc.getValue());
            zip.putNextEntry(asset);
            for (long remaining = size; remaining > 0;) { int n = (int) Math.min(buffer.length, remaining); zip.write(buffer, 0, n); remaining -= n; }
            zip.closeEntry();
        }
        assertTrue(input.length() <= EsqArchive.MAX_ARCHIVE_BYTES);
        assertTrue(input.length() > EsqArchive.MAX_ARCHIVE_BYTES - 65536);
        JSONObject result = EsqStage.stage(input, temporary.newFolder());
        assertEquals(size, result.getJSONArray("assets").getJSONObject(0).getLong("size"));
        System.out.println("CAPACITY_ESQ bytes=" + input.length() + " heap=" + Runtime.getRuntime().maxMemory());
    }

    @Test public void selectingAgainRepairsCorruptRetainedSource() throws Exception {
        File root = temporary.newFolder();
        File source = archive();
        String id = EsqStage.stage(source, root).getString("stageId");
        File task = new File(root, "esq-tasks/" + id);
        java.nio.file.Files.write(new File(task, "source.esq").toPath(), "corrupt".getBytes(StandardCharsets.UTF_8));
        assertTrue(new File(task, "ready.json").delete());
        assertEquals(id, EsqStage.stage(source, root).getString("stageId"));
    }

    @Test public void archiveLimitRejectsBeforeReadingInput() throws Exception {
        InputStream source = new InputStream() { public int read() { fail("must not read oversized input"); return -1; } };
        assertThrows(SecurityException.class, () -> EsqStage.receive(source, EsqArchive.MAX_ARCHIVE_BYTES + 1, temporary.newFolder()));
    }
}

package com.wssfk.englishpracticemachine;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.io.FileOutputStream;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

public class EsqArchiveTest {
    @Rule
    public TemporaryFolder temporary = new TemporaryFolder();

    @Test
    public void safeEntryNameRejectsTraversalAndDangerousFiles() {
        assertThrows(SecurityException.class, () -> EsqArchive.safeEntryName("../manifest.json"));
        assertThrows(SecurityException.class, () -> EsqArchive.safeEntryName("assets/run.js"));
        assertEquals("assets/audio/sample.mp3", EsqArchive.safeEntryName("assets/audio/sample.mp3"));
    }

    @Test
    public void archiveLimitIsExactlyTwoGiB() throws Exception {
        assertEquals(2L * 1024L * 1024L * 1024L, EsqArchive.MAX_ARCHIVE_BYTES);
        File archive = temporary.newFile("oversize.esq");
        try (RandomAccessFile sparse = new RandomAccessFile(archive, "rw")) {
            sparse.setLength(EsqArchive.MAX_ARCHIVE_BYTES + 1L);
        }
        assertThrows(SecurityException.class, () ->
            EsqArchive.extract(archive, temporary.newFolder("oversize-data"), "0".repeat(64)));
    }

    @Test
    public void extractRejectsCompressionBomb() throws Exception {
        File archive = temporary.newFile("compression-bomb.esq");
        try (ZipOutputStream zip = new ZipOutputStream(new FileOutputStream(archive))) {
            add(zip, "manifest.json", new byte[2 * 1024 * 1024]);
        }
        assertThrows(SecurityException.class, () ->
            EsqArchive.extract(archive, temporary.newFolder("bomb-data"), sha256(archive)));
    }

    @Test
    public void extractRejectsDuplicateNormalizedPaths() throws Exception {
        File archive = temporary.newFile("duplicate.esq");
        try (ZipOutputStream zip = new ZipOutputStream(new FileOutputStream(archive))) {
            add(zip, "assets\\audio.mp3", "first");
            add(zip, "assets/audio.mp3", "second");
        }
        assertThrows(SecurityException.class, () ->
            EsqArchive.extract(archive, temporary.newFolder("duplicate-data"), sha256(archive)));
    }

    @Test
    public void extractRejectsAssetHashMismatchAndRemovesStagingDirectory() throws Exception {
        File archive = temporary.newFile("bad.esq");
        byte[] audio = "audio bytes".getBytes(StandardCharsets.UTF_8);
        String wrongHash = "0".repeat(64);
        try (ZipOutputStream zip = new ZipOutputStream(new FileOutputStream(archive))) {
            add(zip, "manifest.json", "{\"packageId\":\"test.bank\",\"contentVersion\":\"1.0.0\",\"papers\":[{\"paperKey\":\"p1\",\"path\":\"papers/p1.json\",\"answerPath\":\"answers/p1.json\"}]}");
            add(zip, "papers/p1.json", "{\"paperKey\":\"p1\",\"year\":2026,\"units\":[]}");
            add(zip, "answers/p1.json", "{\"paperKey\":\"p1\",\"answers\":{}}");
            add(zip, "assets/index.json", "{\"assets\":[{\"assetId\":\"a1\",\"path\":\"assets/audio/a.mp3\",\"size\":" + audio.length + ",\"sha256\":\"" + wrongHash + "\"}]}");
            add(zip, "assets/audio/a.mp3", audio);
        }
        File dataRoot = temporary.newFolder("data");
        assertThrows(SecurityException.class, () -> EsqArchive.extract(archive, dataRoot, sha256(archive)));
        File questionBanks = new File(dataRoot, "question-banks");
        File[] leftovers = questionBanks.listFiles((directory, name) -> name.startsWith(".staging-"));
        assertTrue(leftovers == null || leftovers.length == 0);
        assertFalse(new File(questionBanks, "test.bank").exists());
    }

    @Test
    public void repeatedExtractVerifiesAndReusesExistingAssets() throws Exception {
        File archive = validArchive();
        File dataRoot = temporary.newFolder("reused-data");
        String hash = sha256(archive);
        EsqArchive.Extraction first = EsqArchive.extract(archive, dataRoot, hash);
        assertTrue(first.createdDirectory.isDirectory());
        EsqArchive.Extraction second = EsqArchive.extract(archive, dataRoot, hash);
        assertEquals(null, second.createdDirectory);
        assertEquals(1, second.packageData.getJSONArray("assets").length());
    }

    @Test
    public void extractAcceptsLegacyBytesAssetDeclaration() throws Exception {
        File archive = legacyBytesArchive();
        File dataRoot = temporary.newFolder("bytes-data");
        EsqArchive.Extraction extraction = EsqArchive.extract(archive, dataRoot, sha256(archive));
        assertTrue(extraction.createdDirectory.isDirectory());
        assertEquals(1, extraction.packageData.getJSONArray("assets").length());
    }

    @Test
    public void extractsLanContentFingerprintVersion() throws Exception {
        String version = "1.0.0+" + "a".repeat(64);
        File archive = validArchive(version);
        EsqArchive.Extraction result = EsqArchive.extract(archive, temporary.newFolder("lan-data"), sha256(archive));
        assertEquals(version, result.packageData.getJSONObject("manifest").getString("contentVersion"));
        assertTrue(result.createdDirectory.isDirectory());
    }

    @Test
    public void rejectsTraversalInContentVersion() throws Exception {
        File archive = validArchive("1.0.0+../escape");
        assertThrows(SecurityException.class, () -> EsqArchive.extract(archive, temporary.newFolder("unsafe-data"), sha256(archive)));
    }

    private File validArchive() throws Exception {
        return validArchive("1.0.0");
    }

    private File validArchive(String version) throws Exception {
        File archive = temporary.newFile("valid.esq");
        byte[] audio = "valid audio".getBytes(StandardCharsets.UTF_8);
        String audioHash = sha256(audio);
        try (ZipOutputStream zip = new ZipOutputStream(new FileOutputStream(archive))) {
            add(zip, "manifest.json", "{\"packageId\":\"test.bank\",\"contentVersion\":\"" + version + "\",\"papers\":[{\"paperKey\":\"p1\",\"path\":\"papers/p1.json\",\"answerPath\":\"answers/p1.json\"}]}");
            add(zip, "papers/p1.json", "{\"paperKey\":\"p1\",\"year\":2026,\"units\":[]}");
            add(zip, "answers/p1.json", "{\"paperKey\":\"p1\",\"answers\":{}}");
            add(zip, "assets/index.json", "{\"assets\":[{\"assetId\":\"a1\",\"path\":\"assets/audio/a.mp3\",\"size\":" + audio.length + ",\"sha256\":\"" + audioHash + "\"}]}");
            add(zip, "assets/audio/a.mp3", audio);
        }
        return archive;
    }

    private File legacyBytesArchive() throws Exception {
        File archive = temporary.newFile("legacy-bytes.esq");
        byte[] audio = "legacy bytes audio".getBytes(StandardCharsets.UTF_8);
        String audioHash = sha256(audio);
        try (ZipOutputStream zip = new ZipOutputStream(new FileOutputStream(archive))) {
            add(zip, "manifest.json", "{\"packageId\":\"test.bank\",\"contentVersion\":\"1.0.0\",\"papers\":[{\"paperKey\":\"p1\",\"path\":\"papers/p1.json\",\"answerPath\":\"answers/p1.json\"}]}");
            add(zip, "papers/p1.json", "{\"paperKey\":\"p1\",\"year\":2026,\"units\":[]}");
            add(zip, "answers/p1.json", "{\"paperKey\":\"p1\",\"answers\":{}}");
            add(zip, "assets/index.json", "{\"assets\":[{\"assetId\":\"a1\",\"path\":\"assets/audio/a.mp3\",\"bytes\":" + audio.length + ",\"sha256\":\"" + audioHash + "\"}]}");
            add(zip, "assets/audio/a.mp3", audio);
        }
        return archive;
    }

    private static void add(ZipOutputStream zip, String name, String text) throws Exception {
        add(zip, name, text.getBytes(StandardCharsets.UTF_8));
    }

    private static void add(ZipOutputStream zip, String name, byte[] value) throws Exception {
        zip.putNextEntry(new ZipEntry(name));
        zip.write(value);
        zip.closeEntry();
    }

    private static String sha256(File file) throws Exception {
        return sha256(Files.readAllBytes(file.toPath()));
    }

    private static String sha256(byte[] value) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(value);
        StringBuilder result = new StringBuilder();
        for (byte item : digest) result.append(String.format(Locale.ROOT, "%02x", item));
        return result.toString();
    }
}

package com.wssfk.englishpracticemachine;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

final class EsqArchive {
    static final long MAX_ARCHIVE_BYTES = 2L * 1024L * 1024L * 1024L;
    static final int MAX_ENTRIES = 10_000;
    static final long MAX_JSON_BYTES = 64L * 1024L * 1024L;
    static final long MAX_TOTAL_JSON_BYTES = 256L * 1024L * 1024L;
    static final long MAX_UNCOMPRESSED_BYTES = 8L * 1024L * 1024L * 1024L;
    static final long MAX_COMPRESSION_RATIO = 250L;
    private static final String DANGEROUS = "(?i).+\\.(exe|dll|bat|cmd|ps1|js|html|htm|apk|dex|so|jar|class)$";
    private static final long MIN_FREE_SPACE_BYTES = 64L * 1024L * 1024L;

    static final class Extraction {
        final JSONObject packageData;
        final File createdDirectory;

        Extraction(JSONObject packageData, File createdDirectory) {
            this.packageData = packageData;
            this.createdDirectory = createdDirectory;
        }
    }

    private EsqArchive() {}

    static Extraction extract(File archive, File dataRoot, String archiveSha256) throws Exception {
        if (!archive.isFile() || archive.length() < 1 || archive.length() > MAX_ARCHIVE_BYTES) {
            throw new SecurityException("ESQ 文件大小无效");
        }
        if (archiveSha256 == null || !archiveSha256.matches("(?i)^[a-f0-9]{64}$")) {
            throw new SecurityException("ESQ SHA-256 无效");
        }
        File staging = new File(dataRoot, "question-banks/.staging-" + UUID.randomUUID());
        try (ZipFile zip = new ZipFile(archive)) {
            Map<String, ZipEntry> entries = inspect(zip);
            long[] jsonTotal = {0L};
            JSONObject manifest = readJson(zip, required(entries, "manifest.json"), jsonTotal);
            String packageId = safeIdentity(manifest.optString("packageId"), "packageId");
            String contentVersion = safeIdentity(manifest.optString("contentVersion"), "contentVersion");
            JSONArray descriptors = manifest.optJSONArray("papers");
            if (descriptors == null || descriptors.length() < 1 || descriptors.length() > 5000) {
                throw new SecurityException("ESQ 试卷清单无效");
            }

            JSONObject assetIndex = entries.containsKey("assets/index.json")
                ? readJson(zip, entries.get("assets/index.json"), jsonTotal)
                : new JSONObject().put("assets", new JSONArray());
            JSONArray assets = assetIndex.optJSONArray("assets");
            if (assets == null || assets.length() > 5000) throw new SecurityException("ESQ 资产清单无效");

            String versionDirName = contentVersion + "-" + archiveSha256.substring(0, 16).toLowerCase(Locale.ROOT);
            String relativeRoot = "question-banks/" + packageId + "/" + versionDirName;
            File finalDir = child(dataRoot, relativeRoot);
            if (finalDir.exists() && !finalDir.isDirectory()) {
                throw new SecurityException("题库资产目标不是目录");
            }
            boolean existingDirectory = finalDir.isDirectory();
            long assetBytes = declaredAssetBytes(assets);
            if (!existingDirectory) {
                if (dataRoot.getUsableSpace() < assetBytes + MIN_FREE_SPACE_BYTES) {
                    throw new IOException("设备可用空间不足，无法解压题库资产");
                }
                if (!staging.mkdirs()) throw new IOException("无法创建题库资产临时目录");
            }
            JSONObject result = new JSONObject().put("manifest", manifest);
            JSONArray papers = new JSONArray();
            for (int index = 0; index < descriptors.length(); index++) {
                JSONObject descriptor = descriptors.getJSONObject(index);
                String paperPath = safeEntryName(descriptor.optString("path"));
                String answerPath = safeEntryName(descriptor.optString("answerPath"));
                JSONObject item = new JSONObject()
                    .put("descriptor", descriptor)
                    .put("paper", readJson(zip, required(entries, paperPath), jsonTotal))
                    .put("answers", readJson(zip, required(entries, answerPath), jsonTotal));
                String labelPath = descriptor.optString("labelPath", "");
                item.put("labels", labelPath.isEmpty()
                    ? JSONObject.NULL
                    : readJson(zip, required(entries, safeEntryName(labelPath)), jsonTotal));
                papers.put(item);
            }
            result.put("papers", papers);

            JSONArray extractedAssets = new JSONArray();
            Set<String> assetIds = new HashSet<>();
            for (int index = 0; index < assets.length(); index++) {
                JSONObject asset = assets.getJSONObject(index);
                String assetId = asset.optString("assetId", "");
                String path = safeEntryName(asset.optString("path", ""));
                String expectedHash = asset.optString("sha256", "");
                // size 为格式权威字段；bytes 是旧版 Windows 导出的历史别名，兼容读取。
                long expectedSize = asset.optLong("size", asset.optLong("bytes", -1L));
                if (assetId.isEmpty() || !assetIds.add(assetId)
                    || !expectedHash.matches("(?i)^[a-f0-9]{64}$") || expectedSize < 0) {
                    throw new SecurityException("ESQ 资产声明无效");
                }
                ZipEntry entry = required(entries, path);
                if (entry.getSize() != expectedSize) throw new SecurityException("ESQ 资产大小不匹配：" + path);
                File output = child(existingDirectory ? finalDir : staging, path);
                String actualHash;
                if (existingDirectory) {
                    actualHash = hashExisting(output, expectedSize);
                } else {
                    File parent = output.getParentFile();
                    if (parent == null || (!parent.isDirectory() && !parent.mkdirs())) {
                        throw new IOException("无法创建题库资产目录");
                    }
                    actualHash = copyAndHash(zip.getInputStream(entry), output, expectedSize);
                }
                if (!actualHash.equalsIgnoreCase(expectedHash)) {
                    throw new SecurityException("ESQ 资产 SHA-256 校验失败：" + path);
                }
                extractedAssets.put(new JSONObject()
                    .put("assetId", assetId)
                    .put("mediaType", asset.optString("mediaType", "application/octet-stream"))
                    .put("originalName", asset.optString("originalName", ""))
                    .put("label", asset.optString("label", ""))
                    .put("size", expectedSize)
                    .put("sha256", expectedHash.toLowerCase(Locale.ROOT))
                    .put("storedPath", relativeRoot + "/" + path));
            }

            File createdDirectory = null;
            if (!existingDirectory) {
                File parent = finalDir.getParentFile();
                if (parent == null || (!parent.isDirectory() && !parent.mkdirs())) {
                    throw new IOException("无法创建题库版本目录");
                }
                try {
                    Files.move(staging.toPath(), finalDir.toPath(), StandardCopyOption.ATOMIC_MOVE);
                } catch (IOException atomicMoveError) {
                    Files.move(staging.toPath(), finalDir.toPath());
                }
                createdDirectory = finalDir;
            }
            result.put("assets", extractedAssets);
            return new Extraction(result, createdDirectory);
        } catch (Exception error) {
            deleteTree(staging);
            throw error;
        }
    }

    private static long declaredAssetBytes(JSONArray assets) throws Exception {
        long total = 0L;
        for (int index = 0; index < assets.length(); index++) {
            // size 为格式权威字段；bytes 是旧版 Windows 导出的历史别名，兼容读取。
            long size = assets.getJSONObject(index).optLong("size",
                assets.getJSONObject(index).optLong("bytes", -1L));
            if (size < 0) throw new SecurityException("ESQ 资产声明无效");
            total = Math.addExact(total, size);
            if (total > MAX_UNCOMPRESSED_BYTES) throw new SecurityException("ESQ 资产总大小超过限制");
        }
        return total;
    }

    static String safeEntryName(String raw) {
        String name = raw == null ? "" : raw.replace('\\', '/');
        if (name.isEmpty() || name.startsWith("/") || name.matches("^[A-Za-z]:.*")
            || name.split("/").length == 0 || name.matches(DANGEROUS)) {
            throw new SecurityException("ESQ 包含不安全路径");
        }
        for (String part : name.split("/")) {
            if (part.isEmpty() || part.equals(".") || part.equals("..")) {
                throw new SecurityException("ESQ 包含不安全路径");
            }
        }
        return name;
    }

    private static Map<String, ZipEntry> inspect(ZipFile zip) throws Exception {
        Map<String, ZipEntry> result = new HashMap<>();
        long total = 0L;
        int count = 0;
        var enumeration = zip.entries();
        while (enumeration.hasMoreElements()) {
            ZipEntry entry = enumeration.nextElement();
            if (++count > MAX_ENTRIES) throw new SecurityException("ESQ 文件数量超过限制");
            String rawName = entry.getName();
            String name = safeEntryName(entry.isDirectory() && rawName.endsWith("/")
                ? rawName.substring(0, rawName.length() - 1) : rawName);
            if (result.put(name, entry) != null) throw new SecurityException("ESQ 包含重复文件：" + name);
            if (entry.isDirectory()) continue;
            long size = entry.getSize();
            long compressed = entry.getCompressedSize();
            if (size < 0 || compressed < 0) throw new SecurityException("ESQ ZIP 条目大小无效");
            total = Math.addExact(total, size);
            if (total > MAX_UNCOMPRESSED_BYTES) throw new SecurityException("ESQ 解压后总大小超过限制");
            if (compressed == 0 ? size > 0 : size / Math.max(1L, compressed) > MAX_COMPRESSION_RATIO) {
                throw new SecurityException("ESQ ZIP 压缩比异常");
            }
        }
        return result;
    }

    private static JSONObject readJson(ZipFile zip, ZipEntry entry, long[] total) throws Exception {
        if (entry.getSize() < 0 || entry.getSize() > MAX_JSON_BYTES
            || total[0] + entry.getSize() > MAX_TOTAL_JSON_BYTES) {
            throw new SecurityException("ESQ JSON 数据超过限制");
        }
        total[0] += entry.getSize();
        try (InputStream input = zip.getInputStream(entry); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[64 * 1024];
            int count;
            long read = 0L;
            while ((count = input.read(buffer)) != -1) {
                read += count;
                if (read > MAX_JSON_BYTES) throw new SecurityException("ESQ JSON 数据超过限制");
                output.write(buffer, 0, count);
            }
            return new JSONObject(output.toString(StandardCharsets.UTF_8.name()));
        }
    }

    private static ZipEntry required(Map<String, ZipEntry> entries, String path) {
        ZipEntry entry = entries.get(path);
        if (entry == null || entry.isDirectory()) throw new SecurityException("ESQ 缺少文件：" + path);
        return entry;
    }

    private static String safeIdentity(String value, String label) {
        if (value == null || !value.matches("[A-Za-z0-9][A-Za-z0-9._-]{0,79}")) {
            throw new SecurityException("ESQ " + label + " 无效");
        }
        return value;
    }

    private static File child(File root, String relative) throws IOException {
        File target = new File(root, relative);
        String rootPath = root.getCanonicalPath() + File.separator;
        if (!target.getCanonicalPath().startsWith(rootPath)) throw new SecurityException("ESQ 包含越界路径");
        return target;
    }

    private static String copyAndHash(InputStream input, File output, long expectedSize) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        long total = 0L;
        try (InputStream source = input; FileOutputStream target = new FileOutputStream(output)) {
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = source.read(buffer)) != -1) {
                total += count;
                if (total > expectedSize) throw new SecurityException("ESQ 资产大小不匹配");
                target.write(buffer, 0, count);
                digest.update(buffer, 0, count);
            }
        }
        if (total != expectedSize) throw new SecurityException("ESQ 资产大小不匹配");
        return hex(digest.digest());
    }

    private static String hashExisting(File file, long expectedSize) throws Exception {
        if (!file.isFile() || file.length() != expectedSize) {
            throw new SecurityException("已有题库资产大小不匹配");
        }
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = Files.newInputStream(file.toPath())) {
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = input.read(buffer)) != -1) digest.update(buffer, 0, count);
        }
        return hex(digest.digest());
    }

    private static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) result.append(String.format(Locale.ROOT, "%02x", value));
        return result.toString();
    }

    static void deleteTree(File target) {
        if (target == null || !target.exists()) return;
        File[] children = target.listFiles();
        if (children != null) for (File child : children) deleteTree(child);
        target.delete();
    }
}


package com.wssfk.englishpracticemachine;

import com.google.gson.Strictness;
import com.google.gson.stream.JsonReader;
import com.google.gson.stream.JsonToken;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.charset.CodingErrorAction;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.zip.*;

/** Durable, private staging. Only complete, fsynced records are made visible.
 * The archive is retained for retries; no source path is accepted over the bridge. */
final class EsqStage {
    private static final long RESERVE = 64L * 1024 * 1024;
    private EsqStage() {}

    static synchronized JSONObject stage(File archive, File root) throws Exception {
        try (InputStream input = Files.newInputStream(archive.toPath())) {
            return receive(input, archive.length(), root);
        }
    }

    static synchronized JSONObject receive(InputStream source, long expected, File root) throws Exception {
        return receive(source, expected, root, null);
    }

    static synchronized JSONObject receive(InputStream source, long expected, File root, JSONObject request) throws Exception {
        if (expected < 1 || expected > EsqArchive.MAX_ARCHIVE_BYTES) throw new SecurityException("ESQ 文件不能超过 2048 MiB");
        File tasks = new File(root, "esq-tasks");
        Files.createDirectories(tasks.toPath());
        if (tasks.getUsableSpace() < expected + RESERVE) throw new IOException("设备可用空间不足");
        File part = new File(tasks, UUID.randomUUID() + ".part");
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try {
            long total = 0;
            try (FileOutputStream output = new FileOutputStream(part)) {
                byte[] buffer = new byte[65536];
                int count;
                while ((count = source.read(buffer)) != -1) {
                    total += count;
                    if (total > expected) throw new SecurityException("ESQ 文件大小发生变化");
                    output.write(buffer, 0, count);
                    digest.update(buffer, 0, count);
                }
                if (total != expected) throw new SecurityException("ESQ 文件不完整");
                output.getFD().sync();
            }
            String id = hex(digest.digest());
            File task = task(root, id);
            Files.createDirectories(task.toPath());
            File saved = new File(task, "source.esq");
            // This copy has just been hashed; re-selection also repairs a corrupt retained source.
            move(part, saved);
            if (request != null) writeRecord(new File(task, "request.json"), request);
            return resume(root, id);
        } finally {
            Files.deleteIfExists(part.toPath());
        }
    }

    static synchronized JSONArray pending(File root) throws Exception {
        JSONArray result = new JSONArray();
        File[] tasks = new File(root, "esq-tasks").listFiles();
        if (tasks == null) return result;
        for (File dir : tasks) {
            if (!dir.getName().matches("[a-f0-9]{64}") || !new File(dir, "source.esq").isFile()) continue;
            try { result.put(readRecord(new File(dir, "request.json")).put("stageId", dir.getName())); }
            catch (Exception invalidRequest) { /* incomplete receipts are not recoverable jobs */ }
        }
        return result;
    }

    static synchronized void acknowledge(File root, String id) throws Exception {
        // SQLite now owns the durable draft. Retain source/records for retries.
        Files.deleteIfExists(new File(task(root, id), "request.json").toPath());
    }

    static synchronized JSONObject resume(File root, String id) throws Exception {
        File task = task(root, id);
        File ready = new File(task, "ready.json");
        if (ready.isFile()) {
            try {
                JSONObject summary = readRecord(ready);
                verifyRecords(root, id, summary);
                return summary;
            } catch (Exception invalidRecord) { /* rebuild from verified source */ }
        }
        File archive = new File(task, "source.esq");
        if (!EsqArchive.hashExisting(archive, archive.length()).equals(id)) throw new SecurityException("保留的 ESQ 文件校验失败，请重新选择题包");
        writeRecord(new File(task, "state.json"), new JSONObject().put("phase", "parsing"));
        try {
            Files.deleteIfExists(ready.toPath());
            EsqArchive.Extraction result = EsqArchive.extract(archive, root, id,
                (zip, entries, descriptor, index) -> parsePaper(zip, entries, descriptor, new File(task, "p" + index)));
            JSONObject summary = result.packageData.put("stageId", id).put("stageVersion", 1);
            writeRecord(ready, summary);
            writeRecord(new File(task, "state.json"), new JSONObject().put("phase", "ready"));
            return summary;
        } catch (Exception error) {
            writeRecord(new File(task, "state.json"), new JSONObject().put("phase", "failed"));
            throw error;
        }
    }

    private static void verifyRecords(File root, String id, JSONObject summary) throws Exception {
        JSONArray papers = summary.getJSONArray("papers");
        for (int p = 0; p < papers.length(); p++) {
            JSONObject paper = papers.getJSONObject(p);
            int total = 0;
            for (int u = 0; u < paper.getInt("unitCount"); u++) {
                JSONArray questions = read(root, id, p, u, -1).getJSONArray("questions");
                for (int q = 0; q < questions.length(); q++) {
                    JSONObject record = read(root, id, p, u, q);
                    if (!questions.getJSONObject(q).getString("questionKey").equals(record.getJSONObject("question").getString("questionKey"))) throw new SecurityException("暂存题目标识无效");
                    total++;
                }
            }
            if (total != paper.getInt("questionCount")) throw new SecurityException("暂存题目数量无效");
        }
        JSONArray assets = summary.getJSONArray("assets");
        for (int a = 0; a < assets.length(); a++) {
            JSONObject asset = assets.getJSONObject(a);
            File file = new File(root, EsqArchive.safeEntryName(asset.getString("storedPath")));
            if (!asset.getString("sha256").equalsIgnoreCase(EsqArchive.hashExisting(file, asset.getLong("size")))) throw new SecurityException("暂存媒体校验失败");
        }
    }

    static JSONObject read(File root, String id, int paper, int unit, int question) throws Exception {
        if (paper < 0 || unit < 0 || question < -1) throw new SecurityException("暂存记录位置无效");
        JSONObject summary = readRecord(new File(task(root, id), "ready.json"));
        JSONObject paperSummary = summary.getJSONArray("papers").getJSONObject(paper);
        if (unit >= paperSummary.getInt("unitCount")) throw new SecurityException("暂存篇目位置无效");
        File paperDir = new File(task(root, id), "p" + paper);
        File unitDir = new File(paperDir, "u" + unit);
        if (question == -1) return readRecord(new File(unitDir, "unit.json"));
        JSONObject value = readRecord(new File(unitDir, "q" + question + ".json"));
        String key = value.getString("questionKey");
        File answerFile = new File(paperDir, "answers/" + keyHash(key) + ".json");
        File labelFile = new File(paperDir, "labels/" + keyHash(key) + ".json");
        return new JSONObject().put("question", value)
            .put("answer", readRecord(answerFile))
            .put("label", labelFile.isFile() ? readRecord(labelFile) : JSONObject.NULL);
    }

    private static JSONObject parsePaper(ZipFile zip, Map<String, ZipEntry> entries, JSONObject descriptor, File dir) throws Exception {
        // This directory contains only derived records for this verified archive.
        EsqArchive.deleteTree(dir);
        Files.createDirectories(dir.toPath());
        String key = descriptor.getString("paperKey");
        parseMap(zip, entries, descriptor.getString("answerPath"), key, "answers", dir);
        if (!descriptor.optString("labelPath").isEmpty()) parseMap(zip, entries, descriptor.getString("labelPath"), key, "labels", dir);
        JSONObject paper = new JSONObject();
        int unitCount = 0, questionCount = 0;
        Set<String> unitKeys = new HashSet<>();
        Set<String> questionKeys = new HashSet<>();
        try (JsonReader reader = reader(zip, entries, descriptor.getString("path"))) {
            Set<String> names = new HashSet<>();
            reader.beginObject();
            while (reader.hasNext()) {
                String name = uniqueName(reader, names);
                if (!name.equals("units")) { paper.put(name, value(reader, 0)); continue; }
                reader.beginArray();
                while (reader.hasNext()) {
                    File unitDir = new File(dir, "u" + unitCount);
                    JSONObject unit = new JSONObject();
                    JSONArray questions = new JSONArray();
                    JSONArray audioBlocks = new JSONArray();
                    Set<String> fields = new HashSet<>();
                    reader.beginObject();
                    while (reader.hasNext()) {
                        String field = uniqueName(reader, fields);
                        if (!field.equals("questions")) { unit.put(field, value(reader, 0)); continue; }
                        reader.beginArray();
                        while (reader.hasNext()) {
                            JSONObject q = (JSONObject) value(reader, 0);
                            String qKey = q.getString("questionKey");
                            if (qKey.isEmpty() || !questionKeys.add(qKey)) throw new SecurityException("题目标识重复或无效");
                            if (!new File(dir, "answers/" + keyHash(qKey) + ".json").isFile()) throw new SecurityException("题目缺少答案");
                            writeRecord(new File(unitDir, "q" + questions.length() + ".json"), q);
                            questions.put(new JSONObject().put("questionKey", qKey).put("number", q.get("number")));
                            collectAudio(q.optJSONArray("stemBlocks"), audioBlocks);
                            JSONArray options = q.optJSONArray("options");
                            if (options != null) for (int o = 0; o < options.length(); o++) collectAudio(options.getJSONObject(o).optJSONArray("contentBlocks"), audioBlocks);
                            questionCount++;
                        }
                        reader.endArray();
                    }
                    reader.endObject();
                    String unitKey = unit.getString("unitKey");
                    if (unitKey.isEmpty() || !unitKeys.add(unitKey)) throw new SecurityException("篇目标识重复或无效");
                    unit.put("questions", questions).put("questionAudioBlocks", audioBlocks);
                    writeRecord(new File(unitDir, "unit.json"), unit);
                    unitCount++;
                }
                reader.endArray();
            }
            reader.endObject();
            if (!names.contains("units") || reader.peek() != JsonToken.END_DOCUMENT) throw new SecurityException("试卷 JSON 无效");
        }
        if (!key.equals(paper.optString("paperKey")) || !(paper.opt("year") instanceof Number)) throw new SecurityException("试卷标识或年份无效");
        return new JSONObject().put("descriptor", descriptor).put("paper", paper).put("unitCount", unitCount).put("questionCount", questionCount);
    }

    private static void collectAudio(JSONArray blocks, JSONArray result) throws Exception {
        if (blocks == null) return;
        for (int i = 0; i < blocks.length(); i++) {
            JSONObject block = blocks.getJSONObject(i);
            if ("audio".equals(block.optString("type"))) result.put(block);
        }
    }

    private static void parseMap(ZipFile zip, Map<String, ZipEntry> entries, String path, String paperKey, String field, File dir) throws Exception {
        try (JsonReader reader = reader(zip, entries, path)) {
            String actualKey = null;
            Set<String> names = new HashSet<>();
            reader.beginObject();
            while (reader.hasNext()) {
                String name = uniqueName(reader, names);
                if (name.equals("paperKey")) { actualKey = reader.nextString(); continue; }
                if (!name.equals(field)) { reader.skipValue(); continue; }
                Set<String> keys = new HashSet<>();
                reader.beginObject();
                while (reader.hasNext()) {
                    String key = uniqueName(reader, keys);
                    writeRecord(new File(dir, field + "/" + keyHash(key) + ".json"), (JSONObject) value(reader, 0));
                }
                reader.endObject();
            }
            reader.endObject();
            if ((field.equals("answers") || actualKey != null) && !paperKey.equals(actualKey)) throw new SecurityException("答案或标注标识无效");
            if (!names.contains(field) || reader.peek() != JsonToken.END_DOCUMENT) throw new SecurityException("答案或标注格式无效");
        }
    }

    private static JsonReader reader(ZipFile zip, Map<String, ZipEntry> entries, String path) throws Exception {
        ZipEntry entry = EsqArchive.required(entries, EsqArchive.safeEntryName(path));
        if (entry.getSize() > EsqArchive.MAX_JSON_BYTES) throw new SecurityException("JSON 超过 64 MiB");
        InputStream limited = new FilterInputStream(zip.getInputStream(entry)) {
            long count;
            final CRC32 crc = new CRC32();
            private void check(int n) throws IOException {
                if (n > 0) count += n;
                if (count > entry.getSize() || count > EsqArchive.MAX_JSON_BYTES) throw new IOException("JSON 大小校验失败");
                if (n == -1 && (count != entry.getSize() || crc.getValue() != entry.getCrc())) throw new IOException("JSON CRC 校验失败");
            }
            @Override public int read() throws IOException { int b = in.read(); if (b >= 0) crc.update(b); check(b < 0 ? -1 : 1); return b; }
            @Override public int read(byte[] b, int off, int len) throws IOException { int n = in.read(b, off, len); if (n > 0) crc.update(b, off, n); check(n); return n; }
        };
        JsonReader reader = new JsonReader(new InputStreamReader(limited, StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)));
        reader.setStrictness(Strictness.STRICT);
        return reader;
    }

    private static String uniqueName(JsonReader reader, Set<String> names) throws Exception {
        String name = reader.nextName();
        if (!names.add(name)) throw new SecurityException("JSON 字段重复");
        return name;
    }

    private static Object value(JsonReader reader, int depth) throws Exception {
        if (depth > 64) throw new SecurityException("JSON 嵌套过深");
        switch (reader.peek()) {
            case BEGIN_OBJECT: {
                JSONObject object = new JSONObject();
                Set<String> names = new HashSet<>();
                reader.beginObject();
                while (reader.hasNext()) object.put(uniqueName(reader, names), value(reader, depth + 1));
                reader.endObject(); return object;
            }
            case BEGIN_ARRAY: {
                JSONArray array = new JSONArray(); reader.beginArray();
                while (reader.hasNext()) array.put(value(reader, depth + 1));
                reader.endArray(); return array;
            }
            case STRING: return reader.nextString();
            case NUMBER: {
                String number = reader.nextString();
                try { return Long.parseLong(number); }
                catch (NumberFormatException fractional) {
                    double result = Double.parseDouble(number);
                    if (!Double.isFinite(result)) throw new SecurityException("JSON 数值无效");
                    return result;
                }
            }
            case BOOLEAN: return reader.nextBoolean();
            case NULL: reader.nextNull(); return JSONObject.NULL;
            default: throw new SecurityException("JSON 值无效");
        }
    }

    private static File task(File root, String id) {
        if (id == null || !id.matches("[a-f0-9]{64}")) throw new SecurityException("暂存任务标识无效");
        return new File(root, "esq-tasks/" + id);
    }
    private static String keyHash(String key) throws Exception { return hex(MessageDigest.getInstance("SHA-256").digest(key.getBytes(StandardCharsets.UTF_8))); }
    private static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder();
        for (byte b : bytes) result.append(String.format(Locale.ROOT, "%02x", b));
        return result.toString();
    }
    private static void move(File from, File to) throws IOException {
        try { Files.move(from.toPath(), to.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING); }
        catch (AtomicMoveNotSupportedException e) { Files.move(from.toPath(), to.toPath(), StandardCopyOption.REPLACE_EXISTING); }
    }
    private static void writeRecord(File file, JSONObject value) throws Exception {
        Files.createDirectories(file.getParentFile().toPath());
        byte[] bytes = value.toString().getBytes(StandardCharsets.UTF_8);
        if (bytes.length > EsqArchive.MAX_JSON_BYTES) throw new SecurityException("暂存记录超过 JSON 限制");
        if (file.getParentFile().getUsableSpace() < bytes.length + RESERVE) throw new IOException("设备可用空间不足");
        File part = new File(file.getPath() + ".part");
        try (FileOutputStream output = new FileOutputStream(part)) {
            output.write(bytes);
            output.write(MessageDigest.getInstance("SHA-256").digest(bytes));
            output.getFD().sync();
        }
        move(part, file);
    }
    private static JSONObject readRecord(File file) throws Exception {
        if (!file.isFile() || file.length() < 34 || file.length() > EsqArchive.MAX_JSON_BYTES + 32) throw new SecurityException("暂存记录缺失或无效，请重新导入");
        byte[] bytes = Files.readAllBytes(file.toPath());
        byte[] content = Arrays.copyOf(bytes, bytes.length - 32);
        if (!MessageDigest.isEqual(MessageDigest.getInstance("SHA-256").digest(content), Arrays.copyOfRange(bytes, bytes.length - 32, bytes.length))) throw new SecurityException("暂存记录校验失败，请重新导入");
        return new JSONObject(new String(content, StandardCharsets.UTF_8));
    }
}

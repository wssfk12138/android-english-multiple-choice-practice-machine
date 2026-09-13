package com.wssfk.englishpracticemachine;

import android.content.Intent;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.net.Uri;
import android.system.Os;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.security.MessageDigest;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * 内部渠道用的私有数据库读取通道。
 *
 * 应用数据目录 /data/data/<包名>/databases 无法被 PC 直接访问（allowBackup=false，adb backup 也不可用），
 * 这里把 SQLite 库导出成一份可供 adb pull 或系统分享的副本：
 * 优先用 SQLite 的 VACUUM INTO 生成单文件一致性快照，失败时退回逐字节复制（连带 -wal / -shm）。
 * 导出目录为外部私有目录 Android/data/<包名>/files/db-export，仅保留最近 {@value #MAX_KEPT_EXPORTS} 次导出。
 * 副本会显式放宽到 0644，否则 shell 用户能列出目录却读不到文件，adb pull 会报 Permission denied。
 */
@CapacitorPlugin(name = "DatabaseExport")
public class DatabaseExportPlugin extends Plugin {

    private static final String SOURCE_FILE_NAME = "english_practice_machineSQLite.db";
    private static final String EXPORT_DIRECTORY_NAME = "db-export";
    private static final String EXPORT_FILE_PREFIX = "english_practice_machine-";
    private static final int MAX_KEPT_EXPORTS = 3;
    private static final int COPY_BUFFER_BYTES = 64 * 1024;
    private static final int STAMP_LENGTH = 15;

    @PluginMethod
    public void getDatabaseInfo(PluginCall call) {
        JSObject result = new JSObject();
        File source = resolveSourceDatabase();
        result.put("expectedFileName", SOURCE_FILE_NAME);
        result.put("maxKeptExports", MAX_KEPT_EXPORTS);
        if (source == null) {
            result.put("exists", false);
            result.put("databases", listDatabaseNames());
            call.resolve(result);
            return;
        }
        result.put("exists", true);
        result.put("fileName", source.getName());
        result.put("size", source.length());
        result.put("modifiedAt", isoTimestamp(source.lastModified()));
        result.put("walBytes", sizeOf(siblingOf(source, "-wal")));
        result.put("shmBytes", sizeOf(siblingOf(source, "-shm")));
        result.put("journalMode", readJournalMode(source));
        result.put("tableCount", countTables(source));
        result.put("databases", listDatabaseNames());
        call.resolve(result);
    }

    @PluginMethod
    public void exportDatabase(PluginCall call) {
        File source = resolveSourceDatabase();
        if (source == null) {
            call.reject("未找到应用数据库文件（" + SOURCE_FILE_NAME + "），请先在应用内打开一次题库");
            return;
        }
        File external = getContext().getExternalFilesDir(null);
        if (external == null) {
            call.reject("当前设备的外部存储不可用，无法写入数据库副本");
            return;
        }
        File exportDirectory = new File(external, EXPORT_DIRECTORY_NAME);
        if (!exportDirectory.isDirectory() && !exportDirectory.mkdirs()) {
            call.reject("无法创建导出目录：" + exportDirectory.getAbsolutePath());
            return;
        }

        String stamp = new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(new Date());
        File target = new File(exportDirectory, EXPORT_FILE_PREFIX + stamp + ".db");
        long walBytes = 0L;
        long shmBytes = 0L;
        boolean walCopied = false;
        String snapshot;
        File walTarget = null;
        File shmTarget = null;
        try {
            deleteQuietly(target);
            try {
                vacuumInto(source, target);
                snapshot = "vacuum-into";
            } catch (Exception vacuumFailure) {
                deleteQuietly(target);
                copyFile(source, target);
                File wal = siblingOf(source, "-wal");
                if (wal != null && wal.isFile() && wal.length() > 0L) {
                    walTarget = new File(exportDirectory, target.getName() + "-wal");
                    copyFile(wal, walTarget);
                    walBytes = wal.length();
                    walCopied = true;
                }
                File shm = siblingOf(source, "-shm");
                if (shm != null && shm.isFile() && shm.length() > 0L) {
                    shmTarget = new File(exportDirectory, target.getName() + "-shm");
                    copyFile(shm, shmTarget);
                    shmBytes = shm.length();
                }
                snapshot = "file-copy";
            }
        } catch (Exception error) {
            call.reject("复制数据库失败", error);
            return;
        }
        if (!target.isFile() || target.length() <= 0L) {
            deleteQuietly(target);
            call.reject("数据库副本为空，导出已取消");
            return;
        }

        boolean adbReadable = makeAdbReadable(target);
        if (walTarget != null) makeAdbReadable(walTarget);
        if (shmTarget != null) makeAdbReadable(shmTarget);

        JSObject result = new JSObject();
        result.put("directory", exportDirectory.getAbsolutePath());
        result.put("path", target.getAbsolutePath());
        result.put("fileName", target.getName());
        result.put("size", target.length());
        result.put("sha256", sha256(target));
        result.put("snapshot", snapshot);
        result.put("integrityCheck", integrityCheck(target));
        result.put("adbReadable", adbReadable);
        result.put("walCopied", walCopied);
        result.put("walBytes", walBytes);
        result.put("shmBytes", shmBytes);
        result.put("copiedAt", isoTimestamp(System.currentTimeMillis()));
        result.put("prunedCount", pruneExports(exportDirectory));
        call.resolve(result);
    }

    @PluginMethod
    public void shareDatabase(PluginCall call) {
        File external = getContext().getExternalFilesDir(null);
        File exportDirectory = external == null ? null : new File(external, EXPORT_DIRECTORY_NAME);
        if (exportDirectory == null || !exportDirectory.isDirectory()) {
            call.reject("还没有数据库副本，请先导出再分享");
            return;
        }
        String requested = call.getString("path");
        File target = requested == null || requested.trim().isEmpty()
            ? latestExport(exportDirectory)
            : new File(requested.trim());
        if (target == null || !target.isFile()) {
            call.reject("没有可分享的数据库副本，请先导出");
            return;
        }
        if (!isInside(exportDirectory, target)) {
            call.reject("只能分享 db-export 目录内的数据库副本");
            return;
        }
        try {
            Uri uri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                target
            );
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("application/octet-stream");
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.putExtra(Intent.EXTRA_SUBJECT, target.getName());
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, call.getString("title", "发送应用数据库副本"));
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(chooser);
            JSObject result = new JSObject();
            result.put("launched", true);
            result.put("fileName", target.getName());
            call.resolve(result);
        } catch (Exception error) {
            call.reject("无法打开系统发送界面", error);
        }
    }

    /** 首选真实库文件名，其次退回数据目录内体积最大的 .db，兼容库名变化。 */
    private File resolveSourceDatabase() {
        File directory = databaseDirectory();
        if (directory == null) return null;
        File exact = new File(directory, SOURCE_FILE_NAME);
        if (exact.isFile() && exact.length() > 0L) return exact;
        File[] files = directory.listFiles();
        if (files == null) return null;
        File largest = null;
        for (File file : files) {
            if (!file.isFile() || file.length() <= 0L) continue;
            String name = file.getName();
            if (!name.endsWith(".db")) continue;
            if (largest == null || file.length() > largest.length()) largest = file;
        }
        return largest;
    }

    private File databaseDirectory() {
        File probe = getContext().getDatabasePath(SOURCE_FILE_NAME);
        return probe == null ? null : probe.getParentFile();
    }

    private List<String> listDatabaseNames() {
        List<String> names = new ArrayList<>();
        File directory = databaseDirectory();
        File[] files = directory == null ? null : directory.listFiles();
        if (files == null) return names;
        for (File file : files) names.add(file.getName());
        return names;
    }

    private File siblingOf(File source, String suffix) {
        File parent = source.getParentFile();
        return parent == null ? null : new File(parent, source.getName() + suffix);
    }

    private void vacuumInto(File source, File target) {
        SQLiteDatabase database = SQLiteDatabase.openDatabase(
            source.getAbsolutePath(),
            null,
            SQLiteDatabase.OPEN_READONLY
        );
        try {
            database.execSQL("VACUUM INTO " + sqlString(target.getAbsolutePath()));
        } finally {
            database.close();
        }
    }

    private void copyFile(File source, File target) throws Exception {
        try (InputStream input = new FileInputStream(source)) {
            try (FileOutputStream output = new FileOutputStream(target)) {
                byte[] buffer = new byte[COPY_BUFFER_BYTES];
                int read;
                while ((read = input.read(buffer)) > 0) output.write(buffer, 0, read);
                output.flush();
                output.getFD().sync();
            }
        }
    }

    private String integrityCheck(File file) {
        SQLiteDatabase database = null;
        Cursor cursor = null;
        try {
            database = SQLiteDatabase.openDatabase(file.getAbsolutePath(), null, SQLiteDatabase.OPEN_READONLY);
            cursor = database.rawQuery("PRAGMA integrity_check", null);
            if (cursor.moveToFirst()) {
                String value = cursor.getString(0);
                return value == null || value.isEmpty() ? "unknown" : value;
            }
            return "unknown";
        } catch (Exception error) {
            return "unavailable";
        } finally {
            if (cursor != null) cursor.close();
            if (database != null) database.close();
        }
    }

    private String readJournalMode(File file) {
        SQLiteDatabase database = null;
        Cursor cursor = null;
        try {
            database = SQLiteDatabase.openDatabase(file.getAbsolutePath(), null, SQLiteDatabase.OPEN_READONLY);
            cursor = database.rawQuery("PRAGMA journal_mode", null);
            if (cursor.moveToFirst()) {
                String value = cursor.getString(0);
                return value == null || value.isEmpty() ? "unknown" : value;
            }
            return "unknown";
        } catch (Exception error) {
            return "unknown";
        } finally {
            if (cursor != null) cursor.close();
            if (database != null) database.close();
        }
    }

    private int countTables(File file) {
        SQLiteDatabase database = null;
        Cursor cursor = null;
        try {
            database = SQLiteDatabase.openDatabase(file.getAbsolutePath(), null, SQLiteDatabase.OPEN_READONLY);
            cursor = database.rawQuery("SELECT count(*) FROM sqlite_master WHERE type = 'table'", null);
            return cursor.moveToFirst() ? cursor.getInt(0) : -1;
        } catch (Exception error) {
            return -1;
        } finally {
            if (cursor != null) cursor.close();
            if (database != null) database.close();
        }
    }

    private String sha256(File file) {
        try (InputStream input = new FileInputStream(file)) {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[COPY_BUFFER_BYTES];
            int read;
            while ((read = input.read(buffer)) > 0) digest.update(buffer, 0, read);
            StringBuilder hex = new StringBuilder();
            for (byte value : digest.digest()) hex.append(String.format(Locale.US, "%02x", value));
            return hex.toString();
        } catch (Exception error) {
            return "";
        }
    }

    /** 只保留最近几次导出，避免外部目录无限增长；本次刚导出的文件一定在保留集合内。 */
    private int pruneExports(File directory) {
        File[] files = directory.listFiles();
        if (files == null) return 0;
        List<String> stamps = new ArrayList<>();
        for (File file : files) {
            String stamp = stampOf(file.getName());
            if (stamp != null && !stamps.contains(stamp)) stamps.add(stamp);
        }
        if (stamps.size() <= MAX_KEPT_EXPORTS) return 0;
        Collections.sort(stamps);
        List<String> kept = new ArrayList<>(stamps.subList(stamps.size() - MAX_KEPT_EXPORTS, stamps.size()));
        int removed = 0;
        for (File file : files) {
            String stamp = stampOf(file.getName());
            if (stamp == null || kept.contains(stamp)) continue;
            if (file.delete()) removed++;
        }
        return removed;
    }

    private String stampOf(String name) {
        if (!name.startsWith(EXPORT_FILE_PREFIX)) return null;
        int start = EXPORT_FILE_PREFIX.length();
        if (name.length() < start + STAMP_LENGTH) return null;
        return name.substring(start, start + STAMP_LENGTH);
    }

    private File latestExport(File directory) {
        File[] files = directory.listFiles();
        if (files == null) return null;
        File latest = null;
        for (File file : files) {
            if (!file.isFile() || !file.getName().endsWith(".db")) continue;
            if (latest == null || file.lastModified() > latest.lastModified()) latest = file;
        }
        return latest;
    }

    private boolean isInside(File directory, File file) {
        try {
            String parent = directory.getCanonicalPath();
            String child = file.getCanonicalPath();
            return child.startsWith(parent + File.separator);
        } catch (Exception error) {
            return false;
        }
    }

    private long sizeOf(File file) {
        return file != null && file.isFile() ? file.length() : 0L;
    }

    private void deleteQuietly(File file) {
        // 删除失败不影响导出结果，后续同名文件会复用时间戳以外的名称。
        if (file != null && file.exists()) file.delete();
    }

    /**
     * 外部私有目录下的文件默认以 0600 创建，adb shell 能列出目录却读不到文件，
     * 直接 pull 会报 Permission denied。这里把副本放宽到 0644（仍留在应用外部私有目录，不进入公共存储），
     * 失败时返回 false，此时仍可用应用内系统分享取走副本。
     */
    private boolean makeAdbReadable(File file) {
        if (file == null || !file.isFile()) return false;
        try {
            Os.chmod(file.getAbsolutePath(), 0644);
        } catch (Exception error) {
            try {
                file.setReadable(true, false);
            } catch (Exception ignored) {
                // 部分厂商的 FUSE 实现会拒绝放宽权限，保留 0600 并回退到系统分享。
            }
        }
        try {
            return (Os.stat(file.getAbsolutePath()).st_mode & 0777) == 0644;
        } catch (Exception error) {
            return false;
        }
    }

    private String isoTimestamp(long millis) {
        if (millis <= 0L) return "";
        return new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.US).format(new Date(millis));
    }

    private String sqlString(String value) {
        return "'" + value.replace("'", "''") + "'";
    }
}

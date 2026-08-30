package com.wssfk.englishpracticemachine;

import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {
    private static final String PREFS = "english_practice_app_updater";
    private static final String PENDING_FILE = "pending_installer_file";
    private static final String PENDING_VERSION_CODE = "pending_installer_version_code";
    private static final String PENDING_VERSION_NAME = "pending_installer_version_name";
    private static final int QUESTION_BANK_READ_TIMEOUT_MS = 20 * 60 * 1000;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Map<String, File> pendingQuestionBankAssets = new ConcurrentHashMap<>();

    @PluginMethod
    public void downloadQuestionBank(PluginCall call) {
        String url = call.getString("url");
        String expectedHash = call.getString("sha256");
        String requestedName = call.getString("fileName", "question-bank.esq");
        Long expectedSize = call.getLong("expectedSize");
        if (url == null || expectedHash == null
            || !expectedHash.matches("(?i)^[a-f0-9]{64}$")
            || expectedSize == null || expectedSize < 1 || expectedSize > EsqArchive.MAX_ARCHIVE_BYTES) {
            call.reject("题库下载参数无效");
            return;
        }
        String sanitizedName = requestedName.replaceAll("[^A-Za-z0-9._-]", "_");
        final String fileName = sanitizedName.toLowerCase(Locale.ROOT).endsWith(".esq")
            ? sanitizedName : sanitizedName + ".esq";
        executor.execute(() -> downloadQuestionBank(call, url, expectedHash, expectedSize, fileName));
    }

    private void downloadQuestionBank(PluginCall call, String url, String expectedHash, long expectedSize, String fileName) {
        File temporary = new File(getContext().getCacheDir(), "esq-" + System.nanoTime() + "-" + fileName);
        HttpURLConnection connection = null;
        try {
            URL sourceUrl = new URL(url);
            validateRemoteUrl(sourceUrl);
            connection = (HttpURLConnection) sourceUrl.openConnection();
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(QUESTION_BANK_READ_TIMEOUT_MS);
            connection.setInstanceFollowRedirects(true);
            connection.setRequestProperty("Accept", "application/vnd.english-study-question-bank, application/zip");
            connection.connect();
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) throw new IllegalStateException("题库下载失败：" + status);
            validateRemoteUrl(connection.getURL());
            long declaredSize = connection.getContentLengthLong();
            if (declaredSize >= 0 && declaredSize != expectedSize) throw new SecurityException("题库文件大小与目录声明不一致");
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            long total = 0L;
            try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(temporary)) {
                byte[] buffer = new byte[64 * 1024];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    total += count;
                    if (total > expectedSize || total > EsqArchive.MAX_ARCHIVE_BYTES) {
                        throw new SecurityException("下载的 ESQ 文件超过目录声明或 2 GiB 上限");
                    }
                    output.write(buffer, 0, count);
                    digest.update(buffer, 0, count);
                }
            }
            if (total != expectedSize) throw new SecurityException("题库文件大小与目录声明不一致");
            if (!hex(digest.digest()).equalsIgnoreCase(expectedHash)) throw new SecurityException("题库 SHA-256 校验失败，文件可能不完整或已被替换");
            EsqArchive.Extraction extracted = EsqArchive.extract(temporary, getContext().getFilesDir(), expectedHash.toLowerCase(Locale.ROOT));
            String cleanupToken = "";
            if (extracted.createdDirectory != null) {
                cleanupToken = UUID.randomUUID().toString();
                pendingQuestionBankAssets.put(cleanupToken, extracted.createdDirectory);
            }
            JSObject result = new JSObject();
            result.put("packageData", extracted.packageData.toString());
            result.put("cleanupToken", cleanupToken);
            call.resolve(result);
        } catch (Exception error) {
            call.reject(error.getMessage() == null ? "题库下载失败" : error.getMessage(), error);
        } finally {
            if (connection != null) connection.disconnect();
            temporary.delete();
        }
    }

    @PluginMethod
    public void resolveQuestionBankAssets(PluginCall call) {
        String cleanupToken = call.getString("cleanupToken", "");
        Boolean shouldDelete = call.getBoolean("delete");
        if (cleanupToken.isEmpty() || shouldDelete == null) {
            call.reject("题库资产清理参数无效");
            return;
        }
        File directory = pendingQuestionBankAssets.remove(cleanupToken);
        if (directory == null) {
            call.reject("题库资产清理令牌已失效");
            return;
        }
        if (shouldDelete) EsqArchive.deleteTree(directory);
        JSObject result = new JSObject();
        result.put("deleted", shouldDelete && !directory.exists());
        result.put("retained", !shouldDelete && directory.isDirectory());
        call.resolve(result);
    }

    static void validateRemoteUrl(URL url) {
        String protocol = url.getProtocol().toLowerCase(Locale.ROOT);
        if (url.getUserInfo() != null || !protocol.equals("https") || (url.getPort() != -1 && url.getPort() != 443)) {
            throw new SecurityException("题库地址只允许不含凭据的 HTTPS");
        }
        String host = url.getHost().replaceAll("^\\[|\\]$", "").toLowerCase(Locale.ROOT);
        if (host.equals("localhost") || host.endsWith(".localhost") || host.endsWith(".local")
            || isForbiddenIpv4(host) || host.equals("::") || host.equals("::1")
            || host.startsWith("fc") || host.startsWith("fd") || host.matches("^fe[89ab].*")) {
            throw new SecurityException("题库地址不能指向本机、局域网或保留网络");
        }
    }

    private static boolean isForbiddenIpv4(String host) {
        String[] parts = host.split("\\.");
        if (parts.length != 4) return false;
        try {
            int[] octets = new int[4];
            for (int index = 0; index < 4; index++) {
                octets[index] = Integer.parseInt(parts[index]);
                if (octets[index] < 0 || octets[index] > 255 || !parts[index].equals(String.valueOf(octets[index]))) return false;
            }
            return octets[0] == 0 || octets[0] == 10 || octets[0] == 127 || octets[0] >= 224
                || (octets[0] == 169 && octets[1] == 254)
                || (octets[0] == 172 && octets[1] >= 16 && octets[1] <= 31)
                || (octets[0] == 192 && octets[1] == 168);
        } catch (NumberFormatException error) {
            return false;
        }
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url");
        String expectedHash = call.getString("sha256");
        String requestedName = call.getString("fileName", "english-practice-machine-update.apk");
        Integer targetVersionCode = call.getInt("targetVersionCode");
        String targetVersionName = call.getString("targetVersionName", "");
        Long expectedSize = call.getLong("expectedSize");
        if (url == null
            || expectedHash == null
            || !expectedHash.matches("(?i)^[a-f0-9]{64}$")
            || targetVersionCode == null
            || targetVersionCode < 1) {
            call.reject("更新地址或 SHA-256 无效");
            return;
        }
        String sanitizedName = requestedName.replaceAll("[^A-Za-z0-9._-]", "_");
        final String fileName = sanitizedName.toLowerCase(Locale.ROOT).endsWith(".apk")
            ? sanitizedName
            : sanitizedName + ".apk";
        executor.execute(() -> download(
            call,
            url,
            expectedHash,
            fileName,
            expectedSize,
            targetVersionCode,
            targetVersionName
        ));
    }

    @PluginMethod
    public void getPendingInstallerCleanup(PluginCall call) {
        SharedPreferences preferences = preferences();
        String fileName = preferences.getString(PENDING_FILE, "");
        int targetVersionCode = preferences.getInt(PENDING_VERSION_CODE, 0);
        String targetVersionName = preferences.getString(PENDING_VERSION_NAME, "");
        File output = installerFile(fileName);
        if (fileName.isEmpty() || targetVersionCode < 1 || output == null || !output.isFile()) {
            clearPendingInstaller();
            call.resolve(pendingResult(false, "", "", 0));
            return;
        }
        try {
            if (currentVersionCode() < targetVersionCode) {
                call.resolve(pendingResult(false, "", "", 0));
                return;
            }
        } catch (Exception error) {
            call.reject("无法确认当前应用版本", error);
            return;
        }
        call.resolve(pendingResult(true, fileName, targetVersionName, output.length()));
    }

    @PluginMethod
    public void resolveInstallerCleanup(PluginCall call) {
        Boolean shouldDelete = call.getBoolean("delete");
        if (shouldDelete == null) {
            call.reject("请选择保留或删除安装包");
            return;
        }
        String fileName = preferences().getString(PENDING_FILE, "");
        File output = installerFile(fileName);
        boolean existed = output != null && output.isFile();
        boolean deleted = !shouldDelete || !existed || output.delete();
        if (shouldDelete && existed && !deleted) {
            call.reject("安装包删除失败，请稍后重试");
            return;
        }
        clearPendingInstaller();
        JSObject result = new JSObject();
        result.put("deleted", shouldDelete && existed);
        result.put("retained", !shouldDelete && existed);
        call.resolve(result);
    }

    private void download(
        PluginCall call,
        String url,
        String expectedHash,
        String fileName,
        Long expectedSize,
        int targetVersionCode,
        String targetVersionName
    ) {
        File output = installerFile(fileName);
        if (output == null) {
            call.reject("应用缓存目录不可用");
            return;
        }
        HttpURLConnection connection = null;
        try {
            URL updateUrl = new URL(url);
            String protocol = updateUrl.getProtocol().toLowerCase(Locale.ROOT);
            if (!protocol.equals("https") && !protocol.equals("http")) {
                throw new SecurityException("更新地址只允许使用 HTTP 或 HTTPS");
            }
            connection = (HttpURLConnection) updateUrl.openConnection();
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(120000);
            connection.setInstanceFollowRedirects(true);
            connection.connect();
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                throw new IllegalStateException("APK 下载失败：" + status);
            }
            long declaredSize = connection.getContentLengthLong();
            if (expectedSize != null && (expectedSize < 1 || (declaredSize >= 0 && declaredSize != expectedSize))) {
                throw new SecurityException("APK 文件大小与清单声明不一致");
            }
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            long total = 0L;
            try (InputStream input = connection.getInputStream();
                 FileOutputStream target = new FileOutputStream(output)) {
                byte[] buffer = new byte[64 * 1024];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    total += count;
                    if (expectedSize != null && total > expectedSize) throw new SecurityException("APK 文件大小与清单声明不一致");
                    target.write(buffer, 0, count);
                    digest.update(buffer, 0, count);
                }
            }
            if (expectedSize != null && total != expectedSize) throw new SecurityException("APK 文件大小与清单声明不一致");
            if (!hex(digest.digest()).equalsIgnoreCase(expectedHash)) {
                output.delete();
                throw new SecurityException("APK 校验失败，文件可能不完整或已被替换");
            }
            getActivity().runOnUiThread(() -> launchInstaller(
                call,
                output,
                targetVersionCode,
                targetVersionName
            ));
        } catch (Exception error) {
            output.delete();
            call.reject(error.getMessage() == null ? "更新下载失败" : error.getMessage(), error);
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void launchInstaller(
        PluginCall call,
        File output,
        int targetVersionCode,
        String targetVersionName
    ) {
        try {
            Uri uri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                output
            );
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            boolean recorded = preferences().edit()
                .putString(PENDING_FILE, output.getName())
                .putInt(PENDING_VERSION_CODE, targetVersionCode)
                .putString(PENDING_VERSION_NAME, targetVersionName == null ? "" : targetVersionName)
                .commit();
            if (!recorded) throw new IllegalStateException("无法保存安装包清理状态");
            getContext().startActivity(intent);
            JSObject result = new JSObject();
            result.put("launched", true);
            call.resolve(result);
        } catch (Exception error) {
            clearPendingInstaller();
            call.reject("无法打开系统安装界面", error);
        }
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFS, android.content.Context.MODE_PRIVATE);
    }

    @SuppressWarnings("deprecation")
    private long currentVersionCode() throws Exception {
        PackageInfo info = getContext().getPackageManager().getPackageInfo(
            getContext().getPackageName(),
            0
        );
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
            ? info.getLongVersionCode()
            : info.versionCode;
    }

    private File installerFile(String fileName) {
        if (fileName == null || fileName.isEmpty() || !fileName.equals(new File(fileName).getName())) {
            return null;
        }
        File cache = getContext().getExternalCacheDir();
        return cache == null ? null : new File(cache, fileName);
    }

    private void clearPendingInstaller() {
        preferences().edit()
            .remove(PENDING_FILE)
            .remove(PENDING_VERSION_CODE)
            .remove(PENDING_VERSION_NAME)
            .apply();
    }

    private JSObject pendingResult(
        boolean pending,
        String fileName,
        String versionName,
        long size
    ) {
        JSObject result = new JSObject();
        result.put("pending", pending);
        result.put("fileName", fileName);
        result.put("versionName", versionName);
        result.put("size", size);
        return result;
    }

    private static String hex(byte[] bytes) {
        StringBuilder builder = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) builder.append(String.format(Locale.ROOT, "%02x", value));
        return builder.toString();
    }
}

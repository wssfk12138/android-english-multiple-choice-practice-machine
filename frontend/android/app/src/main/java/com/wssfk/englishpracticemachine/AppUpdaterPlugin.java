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
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {
    private static final String PREFS = "english_practice_app_updater";
    private static final String PENDING_FILE = "pending_installer_file";
    private static final String PENDING_VERSION_CODE = "pending_installer_version_code";
    private static final String PENDING_VERSION_NAME = "pending_installer_version_name";
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url");
        String expectedHash = call.getString("sha256");
        String requestedName = call.getString("fileName", "english-practice-machine-update.apk");
        Integer targetVersionCode = call.getInt("targetVersionCode");
        String targetVersionName = call.getString("targetVersionName", "");
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
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            try (InputStream input = connection.getInputStream();
                 FileOutputStream target = new FileOutputStream(output)) {
                byte[] buffer = new byte[64 * 1024];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    target.write(buffer, 0, count);
                    digest.update(buffer, 0, count);
                }
            }
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

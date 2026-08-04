package com.wssfk.englishpracticemachine;

import android.content.Intent;
import android.net.Uri;

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
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url");
        String expectedHash = call.getString("sha256");
        String requestedName = call.getString("fileName", "english-practice-machine-update.apk");
        if (url == null || expectedHash == null || !expectedHash.matches("(?i)^[a-f0-9]{64}$")) {
            call.reject("更新地址或 SHA-256 无效");
            return;
        }
        String sanitizedName = requestedName.replaceAll("[^A-Za-z0-9._-]", "_");
        final String fileName = sanitizedName.toLowerCase(Locale.ROOT).endsWith(".apk")
            ? sanitizedName
            : sanitizedName + ".apk";
        executor.execute(() -> download(call, url, expectedHash, fileName));
    }

    private void download(PluginCall call, String url, String expectedHash, String fileName) {
        File output = new File(getContext().getExternalCacheDir(), fileName);
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
            getActivity().runOnUiThread(() -> launchInstaller(call, output));
        } catch (Exception error) {
            output.delete();
            call.reject(error.getMessage() == null ? "更新下载失败" : error.getMessage(), error);
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void launchInstaller(PluginCall call, File output) {
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
            getContext().startActivity(intent);
            JSObject result = new JSObject();
            result.put("launched", true);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("无法打开系统安装界面", error);
        }
    }

    private static String hex(byte[] bytes) {
        StringBuilder builder = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) builder.append(String.format(Locale.ROOT, "%02x", value));
        return builder.toString();
    }
}

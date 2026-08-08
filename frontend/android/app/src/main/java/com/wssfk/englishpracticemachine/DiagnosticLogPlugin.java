package com.wssfk.englishpracticemachine;

import android.content.Intent;
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
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "DiagnosticLog")
public class DiagnosticLogPlugin extends Plugin {
    @PluginMethod
    public void getDeviceInfo(PluginCall call) {
        JSObject result = new JSObject();
        result.put("androidVersion", Build.VERSION.RELEASE);
        result.put("deviceModel", Build.MANUFACTURER + " " + Build.MODEL);
        call.resolve(result);
    }

    @PluginMethod
    public void shareText(PluginCall call) {
        String text = call.getString("text");
        String requestedName = call.getString("fileName", "english-practice-diagnostics.json");
        String title = call.getString("title", "发送诊断日志");
        if (text == null || text.isEmpty()) {
            call.reject("诊断日志为空");
            return;
        }
        if (text.length() > 1024 * 1024) {
            call.reject("诊断日志超过 1 MiB，无法导出");
            return;
        }
        String fileName = requestedName.replaceAll("[^A-Za-z0-9._-]", "_");
        if (!fileName.toLowerCase().endsWith(".json")) fileName += ".json";
        try {
            File output = new File(getContext().getCacheDir(), fileName);
            try (FileOutputStream stream = new FileOutputStream(output)) {
                stream.write(text.getBytes(StandardCharsets.UTF_8));
            }
            Uri uri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                output
            );
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("application/json");
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, title);
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(chooser);
            JSObject result = new JSObject();
            result.put("launched", true);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("无法打开日志发送界面", error);
        }
    }
}

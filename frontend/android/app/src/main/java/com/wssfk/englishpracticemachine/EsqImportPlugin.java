package com.wssfk.englishpracticemachine;

import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.InputStream;
import java.util.concurrent.*;

@CapacitorPlugin(name = "EsqImport")
public final class EsqImportPlugin extends Plugin {
    private static final ExecutorService executor = Executors.newSingleThreadExecutor();
    private static Uri selectedUri;
    private static String selectedName;
    private static long selectedSize;

    static synchronized void selected(Context context, Uri[] uris) {
        selectedUri = null;
        if (uris == null || uris.length != 1 || !"content".equals(uris[0].getScheme())) return;
        try (Cursor cursor = context.getContentResolver().query(uris[0], new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}, null, null, null)) {
            if (cursor == null || !cursor.moveToFirst()) return;
            selectedName = cursor.getString(0);
            selectedSize = cursor.isNull(1) ? -1 : cursor.getLong(1);
            selectedUri = uris[0];
        } catch (Exception ignored) { selectedUri = null; }
    }

    /**
     * OutOfMemoryError extends Error, not Exception. Letting it escape this executor thread kills the
     * whole process (the "import page closes instantly" failure), so report it as a normal rejection.
     */
    private static String failureMessage(Throwable error) {
        if (error instanceof OutOfMemoryError) {
            return "设备内存不足，无法解析该题库包；请关闭其他应用后重试，或改用较小的题库包";
        }
        String message = error.getMessage();
        return message == null || message.isEmpty() ? error.getClass().getSimpleName() : message;
    }

    private static void reject(PluginCall call, Throwable error) {
        String message = failureMessage(error);
        if (error instanceof Exception) {
            call.reject(message, (Exception) error);
        } else {
            Logger.error("EsqImport", message, error);
            call.reject(message);
        }
    }

    @PluginMethod public void stageSelected(PluginCall call) {
        final Uri uri;
        final long size;
        synchronized (EsqImportPlugin.class) {
            Object rawSize = call.getData().opt("size");
            Long requestedSize = rawSize instanceof Number && Double.isFinite(((Number) rawSize).doubleValue())
                && ((Number) rawSize).doubleValue() == ((Number) rawSize).longValue() ? ((Number) rawSize).longValue() : null;
            if (selectedUri == null || !selectedName.equals(call.getString("name")) || requestedSize == null
                || (selectedSize >= 0 && selectedSize != requestedSize)) {
                call.reject("请重新选择 ESQ 文件后重试"); return;
            }
            uri = selectedUri; size = requestedSize;
        }
        executor.execute(() -> {
            try (InputStream source = getContext().getContentResolver().openInputStream(uri)) {
                if (source == null) throw new IllegalStateException("无法读取所选文件");
                org.json.JSONObject request = new org.json.JSONObject().put("filename", call.getString("name"))
                    .put("profileId", call.getData().opt("profileId"))
                    .put("newProfileName", call.getData().opt("newProfileName"));
                call.resolve(JSObject.fromJSONObject(EsqStage.receive(source, size, getContext().getFilesDir(), request)));
            } catch (Throwable error) { reject(call, error); }
        });
    }

    @PluginMethod public void pending(PluginCall call) {
        executor.execute(() -> {
            try { call.resolve(JSObject.fromJSONObject(new org.json.JSONObject().put("tasks", EsqStage.pending(getContext().getFilesDir())))); }
            catch (Throwable error) { reject(call, error); }
        });
    }

    @PluginMethod public void acknowledge(PluginCall call) {
        executor.execute(() -> {
            try { EsqStage.acknowledge(getContext().getFilesDir(), call.getString("stageId")); call.resolve(); }
            catch (Throwable error) { reject(call, error); }
        });
    }

    @PluginMethod public void resume(PluginCall call) {
        executor.execute(() -> {
            try { call.resolve(JSObject.fromJSONObject(EsqStage.resume(getContext().getFilesDir(), call.getString("stageId")))); }
            catch (Throwable error) { reject(call, error); }
        });
    }

    @PluginMethod public void discard(PluginCall call) {
        executor.execute(() -> {
            try { EsqStage.discard(getContext().getFilesDir(), call.getString("stageId")); call.resolve(); }
            catch (Throwable error) { reject(call, error); }
        });
    }

    @PluginMethod public void read(PluginCall call) {
        executor.execute(() -> {
            try {
                call.resolve(JSObject.fromJSONObject(EsqStage.read(getContext().getFilesDir(), call.getString("stageId"),
                    call.getInt("paper", -1), call.getInt("unit", -1), call.getInt("question", -1))));
            } catch (Throwable error) { reject(call, error); }
        });
    }
}


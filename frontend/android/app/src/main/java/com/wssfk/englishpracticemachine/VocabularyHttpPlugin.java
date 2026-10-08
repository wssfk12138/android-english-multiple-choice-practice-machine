package com.wssfk.englishpracticemachine;

import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "VocabularyHttp")
public class VocabularyHttpPlugin extends Plugin {
    private final VocabularyHttpTransport transport = new VocabularyHttpTransport();
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean pending = new AtomicBoolean();

    @PluginMethod
    public void request(PluginCall call) {
        // Reject a second bridge call immediately; never queue an additional paid request.
        if (!pending.compareAndSet(false, true)) {
            call.reject("词汇传输尚未清理，未发送新请求");
            return;
        }
        try {
            String url = call.getString("url");
            String data = call.getString("data");
            if (url == null || data == null || !"POST".equals(call.getString("method"))) {
                throw new IllegalArgumentException();
            }
            JSObject raw = call.getObject("headers", new JSObject());
            Map<String, String> headers = new LinkedHashMap<>();
            for (Iterator<String> keys = raw.keys(); keys.hasNext();) {
                String key = keys.next();
                headers.put(key, raw.getString(key));
            }
            int connect = call.getInt("connectTimeout", 15000);
            int read = call.getInt("readTimeout", 60000);
            int total = call.getInt("totalTimeout", 240000);
            executor.execute(() -> {
                try {
                    VocabularyHttpTransport.Result result = transport.execute(url, headers, data, connect, read, total);
                    JSObject response = new JSObject();
                    response.put("status", result.status);
                    JSObject responseHeaders = new JSObject();
                    result.headers.forEach(responseHeaders::put);
                    response.put("headers", responseHeaders);
                    response.put("body", Base64.encodeToString(result.body, Base64.NO_WRAP));
                    call.resolve(response);
                } catch (Exception ignored) {
                    // Do not propagate exception messages: they can include credentials or body data.
                    call.reject("词汇传输未确认完成，结果未知；未自动重发");
                } finally { pending.set(false); }
            });
        } catch (Exception ignored) {
            pending.set(false);
            call.reject("词汇传输配置无效，未发送请求");
        }
    }

    @Override protected void handleOnDestroy() {
        transport.close();
        executor.shutdown();
        super.handleOnDestroy();
    }
}

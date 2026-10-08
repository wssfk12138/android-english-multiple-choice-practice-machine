package com.wssfk.englishpracticemachine;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import okhttp3.Call;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okio.BufferedSink;

/** One physical vocabulary call; deadlines cover reading the entire body, not just headers. */
final class VocabularyHttpTransport implements AutoCloseable {
    static final int MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
    private final AtomicBoolean busy = new AtomicBoolean();
    private final OkHttpClient client = new OkHttpClient.Builder()
            .retryOnConnectionFailure(false)
            .followRedirects(false).followSslRedirects(false).build();
    private Call active;
    private boolean closed;

    static final class Result {
        final int status;
        final Map<String, String> headers;
        final byte[] body;
        Result(int status, Map<String, String> headers, byte[] body) {
            this.status = status; this.headers = headers; this.body = body;
        }
    }

    Result execute(String url, Map<String, String> headers, String json,
                   int connectMs, int readMs, int totalMs) throws IOException {
        if (connectMs <= 0 || connectMs > 15000 || readMs <= 0 || readMs > 180000
                || totalMs <= 0 || totalMs > 240000) throw new IllegalArgumentException("Invalid deadline");
        byte[] payload = json.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        // OkHttp follow-ups (including 503 Retry-After: 0) must never replay a paid POST.
        RequestBody body = new RequestBody() {
            @Override public MediaType contentType() { return MediaType.get("application/json; charset=utf-8"); }
            @Override public long contentLength() { return payload.length; }
            @Override public boolean isOneShot() { return true; }
            @Override public void writeTo(BufferedSink sink) throws IOException { sink.write(payload); }
        };
        Request.Builder request = new Request.Builder().url(url).post(body);
        for (Map.Entry<String, String> header : headers.entrySet()) request.header(header.getKey(), header.getValue());
        if (!busy.compareAndSet(false, true)) throw new IOException("Vocabulary transport busy");
        try {
            synchronized (this) {
                if (closed) throw new IOException("Vocabulary transport closed");
                active = client.newBuilder().connectTimeout(connectMs, TimeUnit.MILLISECONDS)
                        .readTimeout(readMs, TimeUnit.MILLISECONDS).writeTimeout(readMs, TimeUnit.MILLISECONDS)
                        .callTimeout(totalMs, TimeUnit.MILLISECONDS).build().newCall(request.build());
            }
            try (Response response = active.execute()) {
                Map<String, String> resultHeaders = new LinkedHashMap<>();
                // The bridge only needs safe request correlation; omit cookies and arbitrary headers.
                for (String name : new String[]{"x-request-id", "request-id"}) {
                    String value = response.header(name);
                    if (value != null && value.matches("[a-zA-Z0-9_.:-]{1,160}")) resultHeaders.put(name, value);
                }
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                if (response.body() != null) {
                    try (InputStream input = response.body().byteStream()) {
                        byte[] buffer = new byte[8192];
                        int count;
                        while ((count = input.read(buffer)) != -1) {
                            if (output.size() + count > MAX_RESPONSE_BYTES) throw new IOException("Response too large");
                            output.write(buffer, 0, count);
                        }
                    }
                }
                return new Result(response.code(), resultHeaders, output.toByteArray());
            }
        } finally {
            synchronized (this) { active = null; }
            // Release only after response/socket cleanup, even on timeout or exception.
            busy.set(false);
        }
    }

    @Override public synchronized void close() {
        closed = true;
        if (active != null) active.cancel();
        client.connectionPool().evictAll();
        client.dispatcher().executorService().shutdown();
    }
}

package com.wssfk.englishpracticemachine;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.URI;
import java.net.Proxy;
import java.security.MessageDigest;
import java.util.concurrent.TimeUnit;
import okhttp3.OkHttpClient;
import okhttp3.Response;
import org.json.JSONObject;

final class LanQuestionBankDownload {
    static void download(String url, LanTlsTrust trust, String token, String sha, long size, File output) throws Exception {
        URI address = URI.create(url);
        if (trust == null || !"/api/lan-sync/question-banks/download".equals(address.getRawPath())
                || address.getRawQuery() != null || address.getRawFragment() != null
                || token == null || !token.matches("[A-Za-z0-9_-]{1,256}")
                || !sha.matches("[a-f0-9]{64}") || size < 1 || size > EsqArchive.MAX_ARCHIVE_BYTES) {
            throw new IllegalArgumentException("Invalid LAN package request");
        }
        OkHttpClient.Builder builder = new OkHttpClient.Builder().proxy(Proxy.NO_PROXY)
                .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
                .connectTimeout(15, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS)
                .callTimeout(20, TimeUnit.MINUTES);
        URI target = trust.target(address);
        trust.configure(builder, address);
        OkHttpClient client = builder.build();
        try {
            String body = new JSONObject().put("token", token).put("sha256", sha).toString();
            try (Response response = client.newCall(LanSyncTransport.request(target, body)).execute()) {
                if (response.code() != 200 || response.body() == null) throw new SecurityException("LAN package access denied");
                if (response.body().contentLength() != size) throw new SecurityException("LAN package size mismatch");
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                long total = 0;
                try (InputStream input = response.body().byteStream(); FileOutputStream stream = new FileOutputStream(output)) {
                    byte[] buffer = new byte[64 * 1024];
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        total += count;
                        if (total > size) throw new SecurityException("LAN package exceeds declared size");
                        stream.write(buffer, 0, count);
                        digest.update(buffer, 0, count);
                    }
                }
                StringBuilder actual = new StringBuilder();
                for (byte value : digest.digest()) actual.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
                if (total != size || !sha.equals(actual.toString())) throw new SecurityException("LAN package integrity failure");
            }
        } finally {
            client.connectionPool().evictAll();
            client.dispatcher().executorService().shutdown();
        }
    }
}

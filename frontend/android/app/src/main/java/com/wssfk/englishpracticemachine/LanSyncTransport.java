package com.wssfk.englishpracticemachine;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.Proxy;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.concurrent.TimeUnit;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

final class LanSyncTransport {
    static final String ALIAS = "lan-sync.invalid";
    static final int MAX_BYTES = 16 * 1024 * 1024;

    static URI validate(String raw) {
        URI uri;
        try { uri = URI.create(raw); }
        catch (RuntimeException e) { throw new IllegalArgumentException("Invalid LAN URL"); }
        String scheme = uri.getScheme();
        if (!("http".equals(scheme) || "https".equals(scheme)) || uri.getHost() == null
                || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null
                || uri.getPort() == 0 || uri.getPort() > 65535) {
            throw new IllegalArgumentException("Invalid LAN URL");
        }
        String path = uri.getRawPath();
        if (!("/api/lan-sync/handshake".equals(path) || "/api/lan-sync/pull".equals(path)
                || "/api/lan-sync/push".equals(path)
                || ("https".equals(scheme) && ("/api/lan-sync/model-keys".equals(path)
                    || "/api/lan-sync/question-banks/catalog".equals(path))))) {
            throw new IllegalArgumentException("Invalid LAN endpoint");
        }
        if ("http".equals(scheme)) privateAddress(uri.getHost());
        if (ALIAS.equalsIgnoreCase(uri.getHost())) throw new IllegalArgumentException("Reserved LAN host");
        return uri;
    }

    static byte[] privateAddress(String host) {
        String[] parts = host.split("\\.", -1);
        if (parts.length != 4) throw new IllegalArgumentException("HTTP requires a private IPv4 literal");
        byte[] address = new byte[4];
        int[] octets = new int[4];
        for (int i = 0; i < 4; i++) {
            if (!parts[i].matches("0|[1-9][0-9]{0,2}")) throw new IllegalArgumentException("Invalid IPv4");
            octets[i] = Integer.parseInt(parts[i]);
            if (octets[i] > 255) throw new IllegalArgumentException("Invalid IPv4");
            address[i] = (byte) octets[i];
        }
        if (!(octets[0] == 10 || (octets[0] == 172 && octets[1] >= 16 && octets[1] <= 31)
                || (octets[0] == 192 && octets[1] == 168))) {
            throw new IllegalArgumentException("HTTP requires RFC1918 private IPv4");
        }
        return address;
    }

    static Request request(URI uri, String json) {
        String target = uri.toASCIIString();
        if ("http".equals(uri.getScheme())) {
            target = "http://" + ALIAS + (uri.getPort() == -1 ? "" : ":" + uri.getPort()) + uri.getRawPath();
        }
        return new Request.Builder().url(target)
                .header("Host", uri.getRawAuthority())
                .header("Accept", "application/json")
                .post(RequestBody.create(json, MediaType.get("application/json; charset=utf-8"))).build();
    }

    static final class Result {
        final int status;
        final String data;
        Result(int status, String data) { this.status = status; this.data = data; }
    }

    static Result post(String raw, String json) throws IOException {
        return post(raw, json, null);
    }

    static Result post(String raw, String json, LanTlsTrust trust) throws IOException {
        URI uri = validate(raw);
        if (("/api/lan-sync/model-keys".equals(uri.getRawPath())
                || "/api/lan-sync/question-banks/catalog".equals(uri.getRawPath())) && trust == null) {
            throw new IllegalArgumentException("Model keys require pinned TLS identity");
        }
        if (json.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) throw new IOException("LAN request too large");
        OkHttpClient.Builder builder = new OkHttpClient.Builder()
                .proxy(Proxy.NO_PROXY).followRedirects(false).followSslRedirects(false)
                .retryOnConnectionFailure(false).connectTimeout(10, TimeUnit.SECONDS)
                .readTimeout(60, TimeUnit.SECONDS).writeTimeout(60, TimeUnit.SECONDS)
                .callTimeout(90, TimeUnit.SECONDS);
        if ("/api/lan-sync/handshake".equals(uri.getRawPath())) {
            builder.connectTimeout(3, TimeUnit.SECONDS).callTimeout(8, TimeUnit.SECONDS);
        }
        // Pin the validated address; never resolve the alias or a user-controlled HTTP hostname via DNS.
        if ("http".equals(uri.getScheme())) {
            InetAddress address = InetAddress.getByAddress(privateAddress(uri.getHost()));
            builder.dns(host -> {
                if (!ALIAS.equals(host)) throw new java.net.UnknownHostException("Unexpected LAN host");
                return Collections.singletonList(address);
            });
        }
        URI target = uri;
        if (trust != null) {
            try {
                target = trust.target(uri);
                trust.configure(builder, uri);
            } catch (IllegalArgumentException e) { throw e; }
            catch (Exception e) { throw new IOException("LAN TLS configuration failed", e); }
        }
        OkHttpClient client = builder.build();
        try (Response response = client.newCall(request(target, json)).execute()) {
            if (response.code() >= 300 && response.code() < 400) throw new IOException("LAN redirects are forbidden");
            if (response.body() == null) throw new IOException("Empty LAN response");
            if (response.body().contentLength() > MAX_BYTES) throw new IOException("LAN response too large");
            try (InputStream input = response.body().byteStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    if (output.size() + count > MAX_BYTES) throw new IOException("LAN response too large");
                    output.write(buffer, 0, count);
                }
                return new Result(response.code(), output.toString(StandardCharsets.UTF_8.name()));
            }
        } finally {
            client.connectionPool().evictAll();
            client.dispatcher().executorService().shutdown();
        }
    }
}

package com.wssfk.englishpracticemachine;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import okhttp3.OkHttpClient;

/** Run by verify_lan_tls_android.py against a temporary Python TLS host. */
public final class LanTlsInterop {
    interface Checked { void run() throws Exception; }
    static int checks;
    static void require(boolean result) {
        if (!result) throw new AssertionError("LAN TLS check failed");
        checks++;
    }
    static void rejects(Checked action) throws Exception {
        try { action.run(); }
        catch (java.io.IOException | java.security.GeneralSecurityException | IllegalArgumentException expected) {
            checks++;
            return;
        }
        throw new AssertionError("Unsafe LAN TLS operation was accepted");
    }
    static String read(Path path) throws java.io.IOException {
        return new String(Files.readAllBytes(path), StandardCharsets.UTF_8);
    }
    public static void main(String[] args) throws Exception {
        Path fixtures = Paths.get(args[0]);
        String hostId = read(fixtures.resolve("host-id")).trim();
        String pem = read(fixtures.resolve("certificate.pem"));
        String pin = read(fixtures.resolve("pin")).trim();
        String base = args[1];
        LanTlsTrust trust = new LanTlsTrust(hostId, pem, pin);
        URI uri = LanSyncTransport.validate(base + "/api/lan-sync/handshake");
        OkHttpClient.Builder builder = new OkHttpClient.Builder();
        trust.configure(builder, uri);
        OkHttpClient configured = builder.build();
        require(configured.dns().lookup(trust.serverName).get(0).getHostAddress().equals(uri.getHost()));
        rejects(() -> configured.dns().lookup("other.invalid"));
        require(trust.target(uri).getHost().equals(trust.serverName));
        require(trust.target(uri).getPort() == uri.getPort());
        rejects(() -> trust.target(URI.create(base.replace("https:", "http:") + "/api/lan-sync/handshake")));
        rejects(() -> new LanTlsTrust(hostId, pem, "sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="));
        rejects(() -> new LanTlsTrust(hostId, pem + pem, pin));
        rejects(() -> new LanTlsTrust("not-an-identity", pem, pin));
        rejects(() -> new LanTlsTrust(hostId, pem, null));
        // The server counts successful requests; these failures must send no application body.
        rejects(() -> LanSyncTransport.post(uri.toString(), "{}"));
        LanTlsTrust wrongName = new LanTlsTrust("00000000-0000-4000-8000-000000000000", pem, pin);
        rejects(() -> LanSyncTransport.post(uri.toString(), "{}", wrongName));
        LanTlsTrust other = new LanTlsTrust(
                read(fixtures.resolve("other-host-id")).trim(),
                read(fixtures.resolve("other-certificate.pem")),
                read(fixtures.resolve("other-pin")).trim());
        rejects(() -> LanSyncTransport.post(uri.toString(), "{}", other));
        rejects(() -> LanSyncTransport.post(base.replace("https:", "http:") + "/api/lan-sync/handshake", "{}", trust));
        LanSyncTransport.Result response = LanSyncTransport.post(uri.toString(), "{}", trust);
        require(response.status == 200 && response.data.contains("tls-probe"));
        rejects(() -> LanSyncTransport.post(base + "/api/lan-sync/pull", "{}", trust));
        configured.connectionPool().evictAll();
        configured.dispatcher().executorService().shutdown();
        System.out.println("Android/OkHttp TLS checks passed: " + checks);
    }
}

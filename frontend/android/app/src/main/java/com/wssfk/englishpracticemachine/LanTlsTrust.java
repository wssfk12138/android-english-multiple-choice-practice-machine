package com.wssfk.englishpracticemachine;

import java.io.ByteArrayInputStream;
import java.net.InetAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.cert.CertificateException;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.util.Base64;
import java.util.Collections;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;
import okhttp3.ConnectionSpec;
import okhttp3.OkHttpClient;

/** Explicit out-of-band trust; never populate this from an unverified HTTP response. */
final class LanTlsTrust {
    final String serverName;
    final X509TrustManager trustManager;
    final SSLContext context;

    LanTlsTrust(String hostId, String pem, String pin) throws Exception {
        if (hostId == null || !hostId.matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
                || pem == null || pem.length() > 8192 || pin == null
                || !pin.matches("sha256/[A-Za-z0-9+/]{43}=")) {
            throw new IllegalArgumentException("Invalid LAN TLS identity");
        }
        serverName = "epm-" + hostId + ".invalid";
        ByteArrayInputStream input = new ByteArrayInputStream(pem.getBytes(StandardCharsets.US_ASCII));
        java.util.Collection<? extends java.security.cert.Certificate> certificates =
                CertificateFactory.getInstance("X.509").generateCertificates(input);
        if (certificates.size() != 1) throw new CertificateException("Exactly one LAN certificate required");
        X509Certificate certificate = (X509Certificate) certificates.iterator().next();
        byte[] expected = Base64.getDecoder().decode(pin.substring(7));
        if (!MessageDigest.isEqual(expected, digest(certificate))) {
            throw new CertificateException("LAN certificate pin mismatch");
        }
        certificate.checkValidity();
        certificate.verify(certificate.getPublicKey());
        if (certificate.getBasicConstraints() != -1) throw new CertificateException("LAN requires a leaf certificate");
        if (certificate.getExtendedKeyUsage() == null
                || !certificate.getExtendedKeyUsage().equals(Collections.singletonList("1.3.6.1.5.5.7.3.1"))) {
            throw new CertificateException("Invalid LAN certificate purpose");
        }
        KeyStore anchors = KeyStore.getInstance(KeyStore.getDefaultType());
        anchors.load(null, null);
        anchors.setCertificateEntry("lan-host", certificate);
        TrustManagerFactory factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        factory.init(anchors);
        X509TrustManager platform = (X509TrustManager) factory.getTrustManagers()[0];
        trustManager = new X509TrustManager() {
            public X509Certificate[] getAcceptedIssuers() { return platform.getAcceptedIssuers(); }
            public void checkClientTrusted(X509Certificate[] chain, String authType) throws CertificateException {
                throw new CertificateException("Client authentication unsupported");
            }
            public void checkServerTrusted(X509Certificate[] chain, String authType) throws CertificateException {
                if (chain == null || chain.length == 0) throw new CertificateException("Missing LAN certificate");
                chain[0].checkValidity();
                if (!MessageDigest.isEqual(expected, digest(chain[0]))) {
                    throw new CertificateException("LAN certificate changed; explicit pairing required");
                }
                platform.checkServerTrusted(chain, authType);
            }
        };
        context = SSLContext.getInstance("TLS");
        context.init(null, new TrustManager[]{trustManager}, null);
    }

    private static byte[] digest(X509Certificate certificate) throws CertificateException {
        try { return MessageDigest.getInstance("SHA-256").digest(certificate.getEncoded()); }
        catch (java.security.NoSuchAlgorithmException e) { throw new CertificateException(e); }
    }

    URI target(URI address) {
        if (!"https".equals(address.getScheme())) throw new IllegalArgumentException("TLS downgrade forbidden");
        LanSyncTransport.privateAddress(address.getHost());
        return URI.create("https://" + serverName
                + (address.getPort() == -1 ? "" : ":" + address.getPort()) + address.getRawPath());
    }

    void configure(OkHttpClient.Builder builder, URI address) throws Exception {
        target(address);
        InetAddress ip = InetAddress.getByAddress(LanSyncTransport.privateAddress(address.getHost()));
        builder.sslSocketFactory(context.getSocketFactory(), trustManager)
                .connectionSpecs(Collections.singletonList(ConnectionSpec.MODERN_TLS))
                .dns(host -> {
                    if (!serverName.equals(host)) throw new java.net.UnknownHostException("Unexpected TLS host");
                    return Collections.singletonList(ip);
                });
        // OkHttp's default hostname verifier still checks the stable identity SAN.
    }
}

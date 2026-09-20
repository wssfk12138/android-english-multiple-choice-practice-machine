package com.wssfk.englishpracticemachine;

import org.junit.Test;
import static org.junit.Assert.*;
import java.net.URI;
import okhttp3.Request;

public class LanSyncTransportTest {
    @Test public void modelKeysRequireHttpsAndPinnedIdentity() {
        assertThrows(IllegalArgumentException.class, () ->
                LanSyncTransport.validate("http://192.168.1.2/api/lan-sync/model-keys"));
        assertNotNull(LanSyncTransport.validate("https://example.com/api/lan-sync/model-keys"));
        assertThrows(IllegalArgumentException.class, () ->
                LanSyncTransport.post("https://example.com/api/lan-sync/model-keys", "{}"));
    }

    @Test public void allowsOnlyPrivateHttpAndSyncEndpoints() {
        for (String host : new String[]{"10.0.0.1", "172.16.0.1", "172.31.255.254", "192.168.1.2"}) {
            assertNotNull(LanSyncTransport.validate("http://" + host + ":8765/api/lan-sync/handshake"));
        }
        for (String raw : new String[]{
                "http://127.0.0.1/api/lan-sync/pull", "http://8.8.8.8/api/lan-sync/pull",
                "http://169.254.1.2/api/lan-sync/pull", "http://172.32.0.1/api/lan-sync/pull",
                "http://192.168.1.256/api/lan-sync/pull", "http://192.168.01.2/api/lan-sync/pull",
                "http://lan-sync.invalid/api/lan-sync/pull", "http://computer.local/api/lan-sync/pull",
                "http://user:secret@192.168.1.2/api/lan-sync/pull", "http://192.168.1.2:0/api/lan-sync/pull",
                "http://192.168.1.2/api/lan-sync/pull?x=1", "http://192.168.1.2/api/lan-sync/pull#x",
                "http://192.168.1.2/api/other", "http://192.168.1.2/api/lan-sync/%70ull",
                "https://lan-sync.invalid/api/lan-sync/pull", "file:///api/lan-sync/pull"}) {
            assertThrows(raw, IllegalArgumentException.class, () -> LanSyncTransport.validate(raw));
        }
    }

    @Test public void rewritesOnlyHttpHostAndPreservesAuthority() {
        URI uri = LanSyncTransport.validate("http://192.168.1.2:8765/api/lan-sync/push");
        Request request = LanSyncTransport.request(uri, "{}");
        assertEquals("http://lan-sync.invalid:8765/api/lan-sync/push", request.url().toString());
        assertEquals("192.168.1.2:8765", request.header("Host"));
        assertEquals("POST", request.method());
        URI secure = LanSyncTransport.validate("https://example.com/api/lan-sync/pull");
        assertEquals(secure.toString(), LanSyncTransport.request(secure, "{}").url().toString());
    }
}

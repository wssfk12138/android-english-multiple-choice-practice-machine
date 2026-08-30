package com.wssfk.englishpracticemachine;

import static org.junit.Assert.assertThrows;

import org.junit.Test;

import java.net.URL;

public class AppUpdaterPluginTest {
    @Test
    public void questionBankUrlsRequireCredentialFreeHttps() throws Exception {
        AppUpdaterPlugin.validateRemoteUrl(new URL("https://example.com/bank.esq"));

        for (String value : new String[] {
            "http://example.com/bank.esq",
            "http://192.168.1.2/bank.esq",
            "https://user:secret@example.com/bank.esq",
            "https://example.com:8443/bank.esq",
            "https://localhost/bank.esq",
            "https://192.168.1.2/bank.esq",
            "https://[::1]/bank.esq",
            "file:///tmp/bank.esq"
        }) {
            assertThrows(SecurityException.class, () -> AppUpdaterPlugin.validateRemoteUrl(new URL(value)));
        }
    }
}

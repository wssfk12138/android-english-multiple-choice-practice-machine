package com.wssfk.englishpracticemachine;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(SecureStorePlugin.class);
        registerPlugin(VocabularyHttpPlugin.class);
        registerPlugin(LanSyncPlugin.class);
        registerPlugin(AppUpdaterPlugin.class);
        registerPlugin(EsqImportPlugin.class);
        registerPlugin(DiagnosticLogPlugin.class);
        registerPlugin(DocumentExtractorPlugin.class);
        registerPlugin(DatabaseExportPlugin.class);
        registerPlugin(MotionPreferencesPlugin.class);
        registerPlugin(TtsPlugin.class);
        super.onCreate(savedInstanceState);
        android.webkit.WebView.setWebContentsDebuggingEnabled(
                getResources().getBoolean(R.bool.webview_debugging_enabled));
        bridge.getWebView().setWebChromeClient(new LocalizedWebChromeClient(bridge));
    }
}

package com.wssfk.englishpracticemachine;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(SecureStorePlugin.class);
        registerPlugin(LanSyncPlugin.class);
        registerPlugin(AppUpdaterPlugin.class);
        registerPlugin(EsqImportPlugin.class);
        registerPlugin(DiagnosticLogPlugin.class);
        registerPlugin(DocumentExtractorPlugin.class);
        registerPlugin(DatabaseExportPlugin.class);
        super.onCreate(savedInstanceState);
        bridge.getWebView().setWebChromeClient(new LocalizedWebChromeClient(bridge));
    }
}

package com.wssfk.englishpracticemachine;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(SecureStorePlugin.class);
        registerPlugin(AppUpdaterPlugin.class);
        registerPlugin(DiagnosticLogPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

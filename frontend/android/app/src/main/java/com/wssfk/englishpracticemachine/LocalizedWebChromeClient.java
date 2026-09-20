package com.wssfk.englishpracticemachine;

import android.app.AlertDialog;
import android.webkit.JsResult;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebChromeClient;

// Retain Capacitor's file picker and permission handlers while localizing confirms.
public final class LocalizedWebChromeClient extends BridgeWebChromeClient {
    private final Bridge bridge;

    public LocalizedWebChromeClient(Bridge bridge) {
        super(bridge);
        this.bridge = bridge;
    }

    @Override
    public boolean onShowFileChooser(WebView view, android.webkit.ValueCallback<android.net.Uri[]> callback, FileChooserParams params) {
        return super.onShowFileChooser(view, uris -> {
            EsqImportPlugin.selected(bridge.getContext(), uris);
            callback.onReceiveValue(uris);
        }, params);
    }

    @Override
    public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
        if (bridge.getActivity().isFinishing() || bridge.getActivity().isDestroyed()) {
            result.cancel();
            return true;
        }
        new AlertDialog.Builder(view.getContext())
            .setMessage(message)
            .setPositiveButton(R.string.confirm_accept, (dialog, which) -> result.confirm())
            .setNegativeButton(R.string.confirm_cancel, (dialog, which) -> result.cancel())
            .setOnCancelListener(dialog -> result.cancel())
            .show();
        return true;
    }
}

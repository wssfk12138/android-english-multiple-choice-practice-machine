package com.wssfk.englishpracticemachine;

import android.database.ContentObserver;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** WebView may not expose Android's remove-animations preference to CSS. */
@CapacitorPlugin(name = "MotionPreferences")
public class MotionPreferencesPlugin extends Plugin {
    private ContentObserver observer;

    private JSObject preferences() {
        JSObject result = new JSObject();
        result.put("reducedMotion", Settings.Global.getFloat(getContext().getContentResolver(),
                Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f);
        return result;
    }

    @Override
    public void load() {
        observer = new ContentObserver(new Handler(Looper.getMainLooper())) {
            @Override
            public void onChange(boolean selfChange) {
                notifyListeners("changed", preferences());
            }
        };
        getContext().getContentResolver().registerContentObserver(
                Settings.Global.getUriFor(Settings.Global.ANIMATOR_DURATION_SCALE), false, observer);
    }

    @PluginMethod
    public void getPreferences(PluginCall call) {
        call.resolve(preferences());
    }

    @Override
    protected void handleOnResume() {
        notifyListeners("changed", preferences());
    }

    @Override
    protected void handleOnDestroy() {
        if (observer != null) getContext().getContentResolver().unregisterContentObserver(observer);
    }
}

package com.wssfk.englishpracticemachine;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import androidx.annotation.NonNull;

import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "SecureStore")
public class SecureStorePlugin extends Plugin {
    private static final String KEY_ALIAS = "english-practice-machine-secure-store-v1";
    private static final String PREFS = "english_practice_secure_store";
    private static final String SEPARATOR = ":";

    @Override
    public void load() {
        // The key itself remains inside Android Keystore. Only ciphertext is stored
        // in app-private SharedPreferences.
        try {
            ensureKey();
        } catch (Exception error) {
            Logger.error("SecureStore initialization failed", error);
        }
    }

    @PluginMethod
    public void get(PluginCall call) {
        String key = requiredKey(call);
        if (key == null) return;
        try {
            String payload = preferences().getString(key, null);
            JSObject result = new JSObject();
            result.put("value", payload == null ? null : decrypt(payload));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("无法读取安全存储", error);
        }
    }

    @PluginMethod
    public void set(PluginCall call) {
        String key = requiredKey(call);
        if (key == null) return;
        String value = call.getString("value");
        if (value == null) {
            call.reject("安全存储值不能为空");
            return;
        }
        try {
            preferences().edit().putString(key, encrypt(value)).apply();
            call.resolve();
        } catch (Exception error) {
            call.reject("无法写入安全存储", error);
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String key = requiredKey(call);
        if (key == null) return;
        preferences().edit().remove(key).apply();
        call.resolve();
    }

    private String requiredKey(PluginCall call) {
        String key = call.getString("key");
        if (key == null || key.trim().isEmpty() || key.length() > 160) {
            call.reject("安全存储键无效");
            return null;
        }
        return key;
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private SecretKey ensureKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) {
            return ((KeyStore.SecretKeyEntry) keyStore.getEntry(KEY_ALIAS, null)).getSecretKey();
        }
        KeyGenerator generator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            "AndroidKeyStore"
        );
        generator.init(new KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .build());
        return generator.generateKey();
    }

    private String encrypt(@NonNull String value) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, ensureKey());
        byte[] iv = cipher.getIV();
        byte[] ciphertext = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
        return Base64.encodeToString(iv, Base64.NO_WRAP)
            + SEPARATOR
            + Base64.encodeToString(ciphertext, Base64.NO_WRAP);
    }

    private String decrypt(@NonNull String payload) throws Exception {
        String[] parts = payload.split(SEPARATOR, -1);
        if (parts.length != 2) throw new IllegalArgumentException("安全存储数据格式无效");
        byte[] iv = Base64.decode(parts[0], Base64.NO_WRAP);
        byte[] ciphertext = Base64.decode(parts[1], Base64.NO_WRAP);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(
            Cipher.DECRYPT_MODE,
            ensureKey(),
            new GCMParameterSpec(128, iv)
        );
        return new String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8);
    }
}

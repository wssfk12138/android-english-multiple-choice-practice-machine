package com.wssfk.englishpracticemachine;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.k2fsa.sherpa.onnx.GeneratedAudio;
import com.k2fsa.sherpa.onnx.OfflineTts;
import com.k2fsa.sherpa.onnx.OfflineTtsConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsVitsModelConfig;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Offline pronunciation backed by the bundled Sherpa-ONNX runtime and Piper
 * INT8 models. The bridge returns as soon as a request is accepted; playback
 * and model errors are delivered through the speechState event.
 */
@CapacitorPlugin(name = "OfflineSpeech")
public class TtsPlugin extends Plugin {
    private static final String EVENT = "speechState";
    private static final String TAG = "OfflineSpeech";
    private static final String ESPEAK_DATA_VERSION = "espeak-data-v1";

    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService synthesizer = Executors.newSingleThreadExecutor();
    private final AtomicInteger generation = new AtomicInteger();

    private volatile OfflineTts usEngine;
    private volatile OfflineTts gbEngine;
    private volatile boolean synthesizing;
    private volatile boolean destroyed;
    private volatile String ownerId = "";
    private volatile String requestId = "";
    private volatile String accent = "";

    private AudioTrack track;
    private AudioManager audioManager;
    private AudioFocusRequest focusRequest;

    @Override
    public void load() {
        // Keep construction cheap. The model is loaded on the first request and
        // never on the WebView or Capacitor bridge thread.
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "").trim();
        String requestedAccent = call.getString("accent", "us");
        String requestedOwner = call.getString("ownerId", "");
        String requestedRequest = call.getString("requestId", "");
        if (text.isEmpty() || text.length() > 500
            || (!"us".equals(requestedAccent) && !"gb".equals(requestedAccent))
            || requestedOwner.isEmpty() || requestedRequest.isEmpty()) {
            call.reject("发音请求无效");
            return;
        }

        final int requestGeneration = generation.incrementAndGet();
        main.post(() -> {
            stopPlayback(false);
            ownerId = requestedOwner;
            requestId = requestedRequest;
            accent = requestedAccent;
            emit("loading", null);
        });
        synthesizer.execute(() -> synthesize(requestGeneration, text, requestedAccent));

        JSObject acknowledgement = new JSObject();
        acknowledgement.put("accepted", true);
        acknowledgement.put("requestId", requestedRequest);
        call.resolve(acknowledgement);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        String requestedOwner = call.getString("ownerId", "");
        main.post(() -> {
            if (!requestedOwner.isEmpty() && !requestedOwner.equals(ownerId)) return;
            generation.incrementAndGet();
            stopPlayback(true);
            ownerId = "";
            requestId = "";
            accent = "";
        });
        call.resolve();
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject result = new JSObject();
        boolean us = hasModel("en_US");
        boolean gb = hasModel("en_GB");
        result.put("ready", us && gb);
        result.put("bundled", true);
        result.put("engine", "sherpa-onnx-1.13.8");
        result.put("us", us);
        result.put("gb", gb);
        call.resolve(result);
    }

    private boolean hasModel(String directory) {
        try {
            getContext().getAssets().open("tts/" + directory + "/model.onnx").close();
            getContext().getAssets().open("tts/" + directory + "/tokens.txt").close();
            return true;
        } catch (IOException error) {
            return false;
        }
    }

    private void synthesize(int requestGeneration, String text, String requestedAccent) {
        synthesizing = true;
        long started = SystemClock.elapsedRealtime();
        try {
            OfflineTts current = engineFor(requestedAccent);
            if (requestGeneration != generation.get()) return;
            GeneratedAudio audio = current.generate(text, 0, 1.0f);
            Log.i(TAG, "generated " + text.length() + " chars in "
                + (SystemClock.elapsedRealtime() - started) + "ms");
            if (requestGeneration != generation.get()) return;
            float[] samples = audio.getSamples();
            int sampleRate = audio.getSampleRate();
            if (samples == null || samples.length == 0 || sampleRate <= 0) {
                main.post(() -> {
                    if (requestGeneration == generation.get()) emit("error", "SYNTHESIS_EMPTY");
                });
                return;
            }
            main.post(() -> play(requestGeneration, samples, sampleRate));
        } catch (Throwable error) {
            main.post(() -> {
                if (requestGeneration == generation.get()) emit("error", "SYNTHESIS_FAILED");
            });
        } finally {
            synthesizing = false;
            if (destroyed) releaseEngines();
        }
    }

    private OfflineTts engineFor(String requestedAccent) throws IOException {
        OfflineTts cached = "gb".equals(requestedAccent) ? gbEngine : usEngine;
        if (cached != null) return cached;
        String directory = "gb".equals(requestedAccent) ? "en_GB" : "en_US";
        String prefix = "tts/" + directory;
        long started = SystemClock.elapsedRealtime();

        OfflineTtsVitsModelConfig vits = new OfflineTtsVitsModelConfig();
        vits.setModel(prefix + "/model.onnx");
        vits.setTokens(prefix + "/tokens.txt");
        // Sherpa-ONNX cannot read espeak-ng-data directly from APK assets: its
        // piper phonemizer needs a real directory. Copy it once to app storage,
        // following the upstream Android example.
        vits.setDataDir(espeakDataDir(directory).getAbsolutePath());
        vits.setNoiseScale(0.667f);
        vits.setNoiseScaleW(0.333f);
        vits.setLengthScale(1.0f);

        OfflineTtsModelConfig model = new OfflineTtsModelConfig();
        model.setVits(vits);
        model.setNumThreads(1);
        model.setDebug(false);
        model.setProvider("cpu");

        OfflineTtsConfig config = new OfflineTtsConfig();
        config.setModel(model);
        config.setMaxNumSentences(1);
        config.setSilenceScale(1.0f);
        OfflineTts created = new OfflineTts(getContext().getAssets(), config);
        if ("gb".equals(requestedAccent)) {
            gbEngine = created;
        } else {
            usEngine = created;
        }
        Log.i(TAG, "engine " + directory + " ready in "
            + (SystemClock.elapsedRealtime() - started) + "ms");
        return created;
    }

    private void releaseEngines() {
        OfflineTts us = usEngine;
        OfflineTts gb = gbEngine;
        usEngine = null;
        gbEngine = null;
        if (us != null) us.release();
        if (gb != null) gb.release();
    }

    private File espeakDataDir(String directory) throws IOException {
        File root = new File(getContext().getFilesDir(),
            "tts/" + ESPEAK_DATA_VERSION + "/" + directory + "/espeak-ng-data");
        if (new File(root, ".ready").isFile()) return root;

        long started = SystemClock.elapsedRealtime();
        File staging = new File(root.getParentFile(), "espeak-ng-data.tmp");
        deleteRecursively(staging);
        File parent = staging.getParentFile();
        if (parent != null && !parent.isDirectory() && !parent.mkdirs()) {
            throw new IOException("Cannot create TTS data directory");
        }
        copyAssetTree("tts/" + directory + "/espeak-ng-data", staging);
        deleteRecursively(root);
        if (!staging.renameTo(root)) {
            deleteRecursively(staging);
            throw new IOException("Cannot activate TTS data directory");
        }
        if (!new File(root, ".ready").createNewFile()) {
            throw new IOException("Cannot mark TTS data directory");
        }
        Log.i(TAG, "copied " + directory + " espeak data in "
            + (SystemClock.elapsedRealtime() - started) + "ms");
        return root;
    }

    private void copyAssetTree(String assetPath, File destination) throws IOException {
        String[] children = getContext().getAssets().list(assetPath);
        if (children == null || children.length == 0) {
            copyAssetFile(assetPath, destination);
            return;
        }
        if (!destination.isDirectory() && !destination.mkdirs()) {
            throw new IOException("Cannot create " + destination.getAbsolutePath());
        }
        for (String child : children) {
            copyAssetTree(assetPath + "/" + child, new File(destination, child));
        }
    }

    private void copyAssetFile(String assetPath, File destination) throws IOException {
        File parent = destination.getParentFile();
        if (parent != null && !parent.isDirectory() && !parent.mkdirs()) {
            throw new IOException("Cannot create " + parent.getAbsolutePath());
        }
        try (InputStream input = getContext().getAssets().open(assetPath);
             OutputStream output = new FileOutputStream(destination)) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
        }
    }

    private boolean deleteRecursively(File file) {
        if (file == null || !file.exists()) return true;
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) {
                for (File child : children) {
                    if (!deleteRecursively(child)) return false;
                }
            }
        }
        return file.delete();
    }

    private void play(int requestGeneration, float[] samples, int sampleRate) {
        if (requestGeneration != generation.get()) return;
        try {
            audioManager = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            AudioAttributes attributes = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build();
            focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(attributes)
                .setOnAudioFocusChangeListener(change -> {
                    if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
                        main.post(() -> {
                            generation.incrementAndGet();
                            stopPlayback(true);
                        });
                    }
                })
                .build();
            int focus = audioManager.requestAudioFocus(focusRequest);
            Log.i(TAG, "audio focus=" + focus);
            if (focus != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
                Log.w(TAG, "audio focus denied");
                emit("error", "AUDIO_FOCUS_DENIED");
                return;
            }

            AudioFormat format = new AudioFormat.Builder()
                .setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
                .setSampleRate(sampleRate)
                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                .build();
            track = new AudioTrack.Builder()
                .setAudioAttributes(attributes)
                .setAudioFormat(format)
                .setTransferMode(AudioTrack.MODE_STATIC)
                .setBufferSizeInBytes(samples.length * Float.BYTES)
                .build();
            int trackState = track.getState();
            if (trackState != AudioTrack.STATE_INITIALIZED
                && trackState != AudioTrack.STATE_NO_STATIC_DATA) {
                Log.e(TAG, "AudioTrack state=" + trackState);
                releaseTrack();
                emit("error", "AUDIO_OUTPUT_FAILED");
                return;
            }
            int written = track.write(samples, 0, samples.length, AudioTrack.WRITE_BLOCKING);
            Log.i(TAG, "AudioTrack wrote " + written + "/" + samples.length
                + " at " + sampleRate + "Hz");
            if (written < 0) {
                releaseTrack();
                emit("error", "AUDIO_OUTPUT_FAILED");
                return;
            }
            track.setNotificationMarkerPosition(samples.length);
            track.setPlaybackPositionUpdateListener(new AudioTrack.OnPlaybackPositionUpdateListener() {
                @Override public void onMarkerReached(AudioTrack ignored) {
                    main.post(() -> finish(requestGeneration));
                }

                @Override public void onPeriodicNotification(AudioTrack ignored) {
                    // Periodic updates are not requested.
                }
            });
            track.play();
            emit("playing", null);
        } catch (Throwable error) {
            Log.e(TAG, "playback failed", error);
            releaseTrack();
            abandonFocus();
            emit("error", "AUDIO_OUTPUT_FAILED");
        }
    }

    private void finish(int requestGeneration) {
        if (requestGeneration != generation.get()) return;
        stopPlayback(true);
    }

    private void stopPlayback(boolean notify) {
        releaseTrack();
        abandonFocus();
        if (notify) emit("idle", null);
    }

    private void releaseTrack() {
        if (track == null) return;
        try {
            track.pause();
            track.flush();
            track.release();
        } catch (Throwable ignored) {
            // The native tracker may already be released after focus loss.
        } finally {
            track = null;
        }
    }

    private void abandonFocus() {
        if (audioManager != null && focusRequest != null) {
            try { audioManager.abandonAudioFocusRequest(focusRequest); } catch (Throwable ignored) {}
        }
        focusRequest = null;
        audioManager = null;
    }

    private void emit(String state, String errorCode) {
        JSObject event = new JSObject();
        event.put("state", state);
        event.put("ownerId", ownerId);
        event.put("requestId", requestId);
        event.put("accent", accent);
        if (errorCode != null) event.put("errorCode", errorCode);
        notifyListeners(EVENT, event);
    }

    @Override
    protected void handleOnPause() {
        generation.incrementAndGet();
        main.post(() -> stopPlayback(true));
        super.handleOnPause();
    }

    @Override
    protected void handleOnDestroy() {
        destroyed = true;
        generation.incrementAndGet();
        main.post(() -> stopPlayback(false));
        synthesizer.shutdownNow();
        if (!synthesizing) releaseEngines();
        super.handleOnDestroy();
    }
}

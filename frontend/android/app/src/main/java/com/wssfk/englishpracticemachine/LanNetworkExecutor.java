package com.wssfk.englishpracticemachine;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;

/** Blocking LAN I/O must never run on Capacitor's shared plugin handler. */
final class LanNetworkExecutor {
    private final ExecutorService worker = Executors.newSingleThreadExecutor(runnable -> {
        Thread thread = new Thread(runnable, "EpmLanNetwork");
        thread.setDaemon(true);
        return thread;
    });

    boolean submit(Runnable operation) {
        try {
            worker.execute(operation);
            return true;
        } catch (RejectedExecutionException stopped) {
            return false;
        }
    }

    void close() {
        worker.shutdownNow();
    }
}

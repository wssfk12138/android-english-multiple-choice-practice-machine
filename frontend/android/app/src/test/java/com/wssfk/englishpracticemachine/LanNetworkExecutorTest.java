package com.wssfk.englishpracticemachine;

import static org.junit.Assert.*;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;

public class LanNetworkExecutorTest {
    @Test public void blockingDiscoveryLeavesCallerFreeAndShutdownInterruptsIt() throws Exception {
        LanNetworkExecutor executor = new LanNetworkExecutor();
        CountDownLatch entered = new CountDownLatch(1);
        CountDownLatch interrupted = new CountDownLatch(1);
        AtomicReference<Thread> networkThread = new AtomicReference<>();
        Thread caller = Thread.currentThread();
        try {
            assertTrue(executor.submit(() -> {
                networkThread.set(Thread.currentThread());
                entered.countDown();
                try { new CountDownLatch(1).await(); }
                catch (InterruptedException stopped) { interrupted.countDown(); Thread.currentThread().interrupt(); }
            }));
            assertTrue(entered.await(2, TimeUnit.SECONDS));
            assertNotSame(caller, networkThread.get());
            executor.close();
            assertTrue(interrupted.await(2, TimeUnit.SECONDS));
            assertFalse(executor.submit(() -> fail("Destroyed executor accepted work")));
        } finally { executor.close(); }
    }
}

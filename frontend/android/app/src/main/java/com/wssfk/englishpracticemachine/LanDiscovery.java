package com.wssfk.englishpracticemachine;

import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Queue;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/** Bounded, unauthenticated locators. Every request still uses the stored TLS pin. */
final class LanDiscovery implements NsdManager.DiscoveryListener {
    private final NsdManager manager;
    private final String hostId;
    private final CountDownLatch done = new CountDownLatch(1);
    private final Set<String> urls = new LinkedHashSet<>();
    private final Set<String> seen = new LinkedHashSet<>();
    private final Queue<NsdServiceInfo> pending = new ArrayDeque<>();
    private boolean closed, resolving, started;

    LanDiscovery(NsdManager manager, String hostId) {
        if (!hostId.matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")) {
            throw new IllegalArgumentException("Invalid host identity");
        }
        this.manager = manager;
        this.hostId = hostId;
    }

    List<String> find() throws InterruptedException {
        try {
            synchronized (this) {
                if (closed) return new ArrayList<>();
                manager.discoverServices("_epm-sync._tcp.", NsdManager.PROTOCOL_DNS_SD, this);
                started = true;
            }
            done.await(4, TimeUnit.SECONDS);
            synchronized (this) { return new ArrayList<>(urls); }
        } finally { close(); }
    }

    synchronized void close() {
        closed = true;
        pending.clear();
        done.countDown();
        if (started) {
            started = false;
            try { manager.stopServiceDiscovery(this); } catch (RuntimeException ignored) { }
        }
    }

    @Override public synchronized void onServiceFound(NsdServiceInfo service) {
        String name = service.getServiceName();
        if (closed || seen.size() >= 8 || name == null || !name.startsWith("epm-" + hostId)
                || !seen.add(name)) return;
        pending.add(service);
        resolveNext();
    }

    @SuppressWarnings("deprecation")
    private synchronized void resolveNext() {
        if (closed || resolving || pending.isEmpty()) return;
        resolving = true;
        try {
            manager.resolveService(pending.remove(), new NsdManager.ResolveListener() {
                @Override public void onResolveFailed(NsdServiceInfo service, int error) { finished(null); }
                @Override public void onServiceResolved(NsdServiceInfo service) { finished(service); }
            });
        } catch (RuntimeException ignored) { finished(null); }
    }

    private synchronized void finished(NsdServiceInfo service) {
        resolving = false;
        if (closed) return;
        if (service != null) {
            try {
                byte[] id = service.getAttributes().get("host_id");
                byte[] version = service.getAttributes().get("version");
                String ip = service.getHost().getHostAddress();
                LanSyncTransport.privateAddress(ip);
                int port = service.getPort();
                if (id != null && version != null && hostId.equals(new String(id, StandardCharsets.UTF_8))
                        && "2".equals(new String(version, StandardCharsets.UTF_8)) && port > 0 && port <= 65535) {
                    urls.add("https://" + ip + ":" + port);
                    if (urls.size() >= 4) done.countDown();
                }
            } catch (RuntimeException ignored) { }
        }
        resolveNext();
    }

    @Override public void onDiscoveryStarted(String type) { }
    @Override public void onDiscoveryStopped(String type) { done.countDown(); }
    @Override public void onServiceLost(NsdServiceInfo service) { }
    @Override public void onStartDiscoveryFailed(String type, int error) { done.countDown(); }
    @Override public void onStopDiscoveryFailed(String type, int error) { done.countDown(); }
}

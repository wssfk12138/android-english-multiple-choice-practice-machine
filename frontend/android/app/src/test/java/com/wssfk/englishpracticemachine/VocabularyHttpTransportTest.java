package com.wssfk.englishpracticemachine;

import org.junit.Test;
import static org.junit.Assert.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

public class VocabularyHttpTransportTest {
    interface Handler { void respond(Socket socket, int number) throws Exception; }
    static final class Server implements AutoCloseable {
        final ServerSocket listener = new ServerSocket(0, 20, InetAddress.getByName("127.0.0.1"));
        final ExecutorService workers = Executors.newCachedThreadPool(r -> { Thread t = new Thread(r); t.setDaemon(true); return t; });
        final AtomicInteger received = new AtomicInteger();
        Server(Handler handler) throws IOException {
            workers.execute(() -> {
                while (!listener.isClosed()) {
                    try {
                        Socket socket = listener.accept();
                        workers.execute(() -> {
                            try (socket) {
                                socket.setSoTimeout(3000);
                                BufferedReader input = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
                                int length = 0;
                                String line;
                                while ((line = input.readLine()) != null && !line.isEmpty()) {
                                    if (line.toLowerCase().startsWith("content-length:")) length = Integer.parseInt(line.substring(15).trim());
                                }
                                for (int i = 0; i < length; i++) input.read();
                                handler.respond(socket, received.incrementAndGet());
                            } catch (Exception ignored) { /* client cancellation is expected in deadline cases */ }
                        });
                    } catch (IOException ignored) { break; }
                }
            });
        }
        String url() { return "http://127.0.0.1:" + listener.getLocalPort() + "/responses"; }
        @Override public void close() throws IOException { listener.close(); workers.shutdownNow(); }
    }
    static void write(Socket socket, String value) throws IOException {
        socket.getOutputStream().write(value.getBytes(StandardCharsets.UTF_8)); socket.getOutputStream().flush();
    }
    static void ok(Socket socket) throws IOException {
        write(socket, "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nX-Request-Id: synthetic-id\r\nSet-Cookie: private\r\nConnection: close\r\n\r\n{}");
    }

    @Test public void readsBodyAndFiltersHeaders() throws Exception {
        try (Server server = new Server((s, n) -> ok(s)); VocabularyHttpTransport transport = new VocabularyHttpTransport()) {
            VocabularyHttpTransport.Result result = transport.execute(server.url(), Map.of("Authorization", "Bearer synthetic"), "{}", 1000, 1000, 2000);
            assertEquals(200, result.status); assertEquals("{}", new String(result.body, StandardCharsets.UTF_8));
            assertEquals(Map.of("x-request-id", "synthetic-id"), result.headers); assertEquals(1, server.received.get());
        }
    }

    @Test public void totalDeadlineStopsContinuousDripAndReleasesOnlyAfterCleanup() throws Exception {
        CountDownLatch disconnected = new CountDownLatch(1);
        try (Server server = new Server((socket, n) -> {
            if (n > 1) { ok(socket); return; }
            write(socket, "HTTP/1.1 200 OK\r\nContent-Length: 10000\r\nConnection: close\r\n\r\n");
            try { while (true) { write(socket, "x"); Thread.sleep(30); } }
            finally { disconnected.countDown(); }
        }); VocabularyHttpTransport transport = new VocabularyHttpTransport()) {
            long start = System.nanoTime();
            assertThrows(IOException.class, () -> transport.execute(server.url(), Map.of(), "{}", 1000, 1000, 350));
            long elapsed = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start);
            assertTrue("deadline elapsed=" + elapsed, elapsed >= 200 && elapsed < 2500);
            assertTrue("socket disconnected", disconnected.await(2, TimeUnit.SECONDS));
            assertEquals(200, transport.execute(server.url(), Map.of(), "{}", 1000, 1000, 2000).status);
            assertEquals(2, server.received.get());
        }
    }

    @Test public void idleReadDeadlineIsIndependentOfTotalDeadline() throws Exception {
        CountDownLatch disconnected = new CountDownLatch(1);
        try (Server server = new Server((socket, n) -> {
            write(socket, "HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\nx");
            if (socket.getInputStream().read() == -1) disconnected.countDown();
        }); VocabularyHttpTransport transport = new VocabularyHttpTransport()) {
            long start = System.nanoTime();
            assertThrows(IOException.class, () -> transport.execute(server.url(), Map.of(), "{}", 1000, 180, 2000));
            assertTrue(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start) < 1500);
            assertTrue(disconnected.await(2, TimeUnit.SECONDS)); assertEquals(1, server.received.get());
        }
    }

    @Test public void activeSlotRejectsAnotherCallAndDestroyCancels() throws Exception {
        CountDownLatch received = new CountDownLatch(1), disconnected = new CountDownLatch(1);
        ExecutorService worker = Executors.newSingleThreadExecutor();
        try (Server server = new Server((socket, n) -> {
            received.countDown(); if (socket.getInputStream().read() == -1) disconnected.countDown();
        }); VocabularyHttpTransport transport = new VocabularyHttpTransport()) {
            Future<?> first = worker.submit(() -> assertThrows(IOException.class, () -> transport.execute(server.url(), Map.of(), "{}", 1000, 3000, 4000)));
            assertTrue(received.await(2, TimeUnit.SECONDS));
            assertThrows(IOException.class, () -> transport.execute(server.url(), Map.of(), "{}", 1000, 1000, 2000));
            assertEquals(1, server.received.get());
            transport.close(); first.get(2, TimeUnit.SECONDS);
            assertTrue(disconnected.await(2, TimeUnit.SECONDS));
            assertThrows(IOException.class, () -> transport.execute(server.url(), Map.of(), "{}", 1000, 1000, 2000));
            assertEquals(1, server.received.get());
        } finally { worker.shutdownNow(); }
    }

    @Test public void rejectionRedirectAndRetryAfterNeverReplayPost() throws Exception {
        for (int code : new int[]{400, 408, 503, 302, 307, 308}) {
            try (Server server = new Server((socket, n) -> write(socket, "HTTP/1.1 " + code + " Synthetic\r\nRetry-After: 0\r\nLocation: /again\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}"));
                 VocabularyHttpTransport transport = new VocabularyHttpTransport()) {
                assertEquals(code, transport.execute(server.url(), Map.of(), "{}", 1000, 1000, 2000).status);
                assertEquals("status=" + code, 1, server.received.get());
            }
        }
    }

    @Test public void brokenConnectionDoesNotReplayAndInvalidPolicyDoesNotSend() throws Exception {
        try (Server server = new Server((socket, n) -> socket.close()); VocabularyHttpTransport transport = new VocabularyHttpTransport()) {
            assertThrows(IOException.class, () -> transport.execute(server.url(), Map.of(), "{}", 1000, 1000, 2000));
            assertEquals(1, server.received.get());
            assertThrows(IllegalArgumentException.class, () -> transport.execute(server.url(), Map.of(), "{}", 15001, 180000, 240000));
            assertThrows(IllegalArgumentException.class, () -> transport.execute(server.url(), Map.of(), "{}", 15000, 180001, 240000));
            assertThrows(IllegalArgumentException.class, () -> transport.execute(server.url(), Map.of(), "{}", 15000, 180000, 240001));
            assertEquals(1, server.received.get());
        }
    }
}

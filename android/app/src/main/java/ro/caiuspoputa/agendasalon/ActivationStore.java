package ro.caiuspoputa.agendasalon;

import android.content.Context;
import android.util.Base64;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InterruptedIOException;
import java.io.OutputStream;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.AlgorithmParameters;
import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.Signature;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.security.spec.ECParameterSpec;
import java.security.spec.X509EncodedKeySpec;
import java.util.UUID;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.SynchronousQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.function.LongSupplier;
import javax.net.ssl.HttpsURLConnection;

/** Signed, installation-bound activation. Only a public verification key is bundled. */
final class ActivationStore {
    static final String ORIGIN = "https://agenda-salon-activare-caius.peachywave5.chatgpt.site";
    static final String ENDPOINT = ORIGIN + "/api/activation/unlock";
    static final String ISSUER = "ro.salon.agenda.test.activation.v1";
    static final String AUDIENCE = "ro.salon.agenda.test.activation";
    static final String PUBLIC_SPKI = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEXpA7Oh3P60VshbVTIHBI3PW1apFHBF60wIuFFl4TGk3mz0U4gb5z437vwGf3jh6IQ9lZvIY2XvsA3QNrhJjf3Q==";
    static final long MAX_LIFETIME_SECONDS = 3650L * 86400;
    static final long REQUEST_TIMEOUT_MILLIS = 30000;
    private static final ThreadPoolExecutor CLEANUP = new ThreadPoolExecutor(0, 1, 10L, TimeUnit.SECONDS,
        new SynchronousQueue<Runnable>(), task -> {
            Thread thread = new Thread(task, "salon-activation-close"); thread.setDaemon(true); return thread;
        }, new ThreadPoolExecutor.AbortPolicy());
    private static final String ID_PATTERN = "[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}";

    static final class ActivationException extends IOException {
        ActivationException(String safeMessage) { super(safeMessage); }
    }

    /** Cancellation never stores input or logs network/receipt contents. */
    static final class Request {
        private boolean cancelled;
        private HttpsURLConnection connection;
        private final LongSupplier clock;
        private final long started;
        Request() { this(System::nanoTime); }
        Request(LongSupplier monotonicClock) { clock = monotonicClock; started = clock.getAsLong(); }
        synchronized void check() throws InterruptedIOException {
            if (cancelled || Thread.currentThread().isInterrupted())
                throw new InterruptedIOException("Activation cancelled");
            if (clock.getAsLong() - started >= TimeUnit.MILLISECONDS.toNanos(REQUEST_TIMEOUT_MILLIS))
                throw new SocketTimeoutException("Activation deadline");
        }
        synchronized void attach(HttpsURLConnection value) throws InterruptedIOException {
            check();
            connection = value;
        }
        synchronized void beforeIo() throws InterruptedIOException {
            check();
            long elapsed = TimeUnit.NANOSECONDS.toMillis(clock.getAsLong() - started);
            int remaining = (int) Math.max(1, REQUEST_TIMEOUT_MILLIS - Math.max(0, elapsed));
            if (connection != null) {
                connection.setConnectTimeout(Math.min(15000, remaining));
                connection.setReadTimeout(Math.min(20000, remaining));
            }
        }
        synchronized boolean detach(HttpsURLConnection value) {
            if (connection != value) return false;
            connection = null;
            return true;
        }
        void cancel() {
            HttpsURLConnection value;
            synchronized (this) { cancelled = true; value = connection; connection = null; }
            if (value != null) disconnectLater(value);
        }
    }

    private static void disconnectLater(HttpsURLConnection connection) {
        // Platform disconnect may block; never run it on the Activity/UI thread.
        // One worker and no queue bound cleanup even after repeated cancellation.
        try { CLEANUP.execute(() -> { try { connection.disconnect(); } catch (RuntimeException ignored) {} }); }
        catch (RejectedExecutionException busy) { /* Existing close is still running; no extra thread/queue. */ }
    }

    static synchronized String installationId(Context context) throws IOException {
        EncryptedActivationStore store = new EncryptedActivationStore(context);
        String value = store.read("installation-id");
        if (value == null) {
            value = UUID.randomUUID().toString();
            store.put("installation-id", value);
        }
        if (!value.matches(ID_PATTERN)) throw new IOException("Invalid installation identity");
        return value;
    }

    static byte[] decode(String encoded, int maxLength) throws GeneralSecurityException {
        if (encoded == null || encoded.isEmpty() || encoded.length() > maxLength
                || !encoded.matches("[A-Za-z0-9_-]+") || encoded.length() % 4 == 1)
            throw new GeneralSecurityException("Invalid activation encoding");
        try {
            byte[] value = Base64.decode(encoded, Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP);
            if (!Base64.encodeToString(value, Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP).equals(encoded))
                throw new GeneralSecurityException("Noncanonical activation encoding");
            return value;
        } catch (IllegalArgumentException failure) {
            throw new GeneralSecurityException("Invalid activation encoding");
        }
    }

    /** WebCrypto uses 64-byte P1363 r||s; Android/JCA SHA256withECDSA expects DER. */
    static byte[] derSignature(byte[] raw) throws GeneralSecurityException {
        if (raw == null || raw.length != 64) throw new GeneralSecurityException("Invalid signature size");
        byte[][] values = new byte[2][];
        for (int part = 0; part < 2; part++) {
            int start = part * 32, end = start + 32;
            while (start < end - 1 && raw[start] == 0) start++;
            boolean pad = (raw[start] & 128) != 0;
            values[part] = new byte[end - start + (pad ? 1 : 0)];
            System.arraycopy(raw, start, values[part], pad ? 1 : 0, end - start);
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(0x30);
        out.write(values[0].length + values[1].length + 4);
        for (byte[] value : values) {
            out.write(2); out.write(value.length); out.write(value, 0, value.length);
        }
        return out.toByteArray();
    }

    private static long integer(JSONObject claims, String name) throws Exception {
        Object value = claims.get(name);
        if (!(value instanceof Integer) && !(value instanceof Long))
            throw new GeneralSecurityException("Invalid activation timestamp");
        return ((Number) value).longValue();
    }

    static boolean verify(String receipt, String spki, String expectedId, long now) {
        try {
            if (receipt == null || receipt.length() > 4096 || expectedId == null
                    || !expectedId.matches(ID_PATTERN) || now < 0) return false;
            String[] parts = receipt.split("\\.", -1);
            if (parts.length != 2) return false;
            byte[] signature = decode(parts[1], 128);
            ECPublicKey key = (ECPublicKey) KeyFactory.getInstance("EC").generatePublic(
                new X509EncodedKeySpec(Base64.decode(spki, Base64.DEFAULT)));
            AlgorithmParameters curve = AlgorithmParameters.getInstance("EC");
            curve.init(new ECGenParameterSpec("secp256r1"));
            ECParameterSpec expected = curve.getParameterSpec(ECParameterSpec.class);
            if (key.getParams().getCurve().getField().getFieldSize() != 256
                    || !key.getParams().getOrder().equals(expected.getOrder())
                    || !key.getParams().getGenerator().equals(expected.getGenerator())) return false;
            Signature verifier = Signature.getInstance("SHA256withECDSA");
            verifier.initVerify(key);
            verifier.update(parts[0].getBytes(StandardCharsets.UTF_8));
            if (!verifier.verify(derSignature(signature))) return false;
            JSONObject claims = new JSONObject(new String(decode(parts[0], 3500), StandardCharsets.UTF_8));
            long issued = integer(claims, "iat"), expires = integer(claims, "exp");
            return integer(claims, "v") == 1
                && ISSUER.equals(claims.get("iss")) && AUDIENCE.equals(claims.get("aud"))
                && "android".equals(claims.get("platform")) && expectedId.equals(claims.get("installationId"))
                && issued >= 0 && issued <= now + 300 && expires > now && expires > issued
                && expires - issued <= MAX_LIFETIME_SECONDS;
        } catch (Exception invalid) { return false; }
    }

    static String token(Context context) {
        try {
            EncryptedActivationStore store = new EncryptedActivationStore(context);
            String receipt = store.read("receipt"), id = store.read("installation-id");
            return verify(receipt, PUBLIC_SPKI, id, System.currentTimeMillis() / 1000) ? receipt : "";
        } catch (Exception invalid) { return ""; }
    }

    static boolean ready(Context context) { return !token(context).isEmpty(); }

    private static synchronized void save(Context context, String receipt, String expectedId) throws Exception {
        EncryptedActivationStore store = new EncryptedActivationStore(context);
        if (!expectedId.equals(store.read("installation-id"))
                || !verify(receipt, PUBLIC_SPKI, expectedId, System.currentTimeMillis() / 1000))
            throw new GeneralSecurityException("Invalid activation receipt");
        store.put("receipt", receipt);
    }

    static String read(InputStream input, int maxBytes, Request request) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[2048];
        int length;
        while (true) {
            request.beforeIo();
            length = input.read(buffer);
            request.check();
            if (length == -1) break;
            if (out.size() + length > maxBytes) throw new IOException("Activation response too large");
            out.write(buffer, 0, length);
        }
        request.check();
        return new String(out.toByteArray(), StandardCharsets.UTF_8);
    }

    static void activate(Context context, String pin, Request request) throws Exception {
        if (pin == null || !pin.matches("[0-9]{6,12}")) throw new ActivationException("PIN incorect.");
        request.check();
        String id;
        try { id = installationId(context); }
        catch (IOException unreadable) {
            // Explicit user activation can repair this activation bucket only.
            new EncryptedActivationStore(context).resetForReactivation();
            id = installationId(context);
        }
        JSONObject payload = new JSONObject().put("pin", pin).put("installationId", id).put("platform", "android");
        byte[] body = payload.toString().getBytes(StandardCharsets.UTF_8);
        if (body.length > 2048) throw new IOException("Activation request too large");
        HttpsURLConnection connection = (HttpsURLConnection) new URL(ENDPOINT).openConnection();
        try {
            request.attach(connection);
            connection.setInstanceFollowRedirects(false);
            connection.setUseCaches(false);
            connection.setConnectTimeout(15000); connection.setReadTimeout(20000);
            connection.setRequestMethod("POST"); connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setRequestProperty("User-Agent", "Agenda-Salon-Android");
            connection.setFixedLengthStreamingMode(body.length);
            request.beforeIo();
            try (OutputStream output = connection.getOutputStream()) { request.check(); output.write(body); request.check(); }
            request.beforeIo();
            int status = connection.getResponseCode();
            request.check();
            if (status == 429) throw new ActivationException("Prea multe încercări. Reîncearcă peste 10 minute.");
            if (status == 400 || status == 401) throw new ActivationException("PIN incorect.");
            if (status != 200) throw new ActivationException("Serviciul de activare nu este disponibil momentan. Reîncearcă mai târziu.");
            JSONObject result;
            try (InputStream input = connection.getInputStream()) {
                if (input == null) throw new IOException("Missing activation response");
                result = new JSONObject(read(input, 16384, request));
            }
            if (!Boolean.TRUE.equals(result.opt("activated")) || !(result.opt("receipt") instanceof String))
                throw new GeneralSecurityException("Activation response invalid");
            synchronized (request) { request.check(); save(context, result.getString("receipt"), id); }
        } finally {
            if (request.detach(connection)) disconnectLater(connection);
        }
    }
}

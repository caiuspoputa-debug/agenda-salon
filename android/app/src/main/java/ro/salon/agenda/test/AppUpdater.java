package ro.salon.agenda.test;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.os.SystemClock;
import android.provider.Settings;
import org.json.JSONObject;
import org.json.JSONTokener;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Future;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.SynchronousQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.net.ssl.SSLException;

/** Foreground update check. Download and Android installation require an explicit user action. */
final class AppUpdater {
    interface Listener { void result(String id, JSONObject result); }
    private final Activity activity;
    private final Listener listener;
    private final UpdateResultMailbox resultMailbox = new UpdateResultMailbox();
    private final ExecutorService executor = Executors.newSingleThreadExecutor(task -> new Thread(task, "salon-update"));
    // A stuck platform DNS/read must not postpone the result or create an unbounded queue of retries.
    private final ExecutorService metadataExecutor = boundedExecutor("salon-update-check");
    private final ExecutorService disconnectExecutor = boundedExecutor("salon-update-close");
    private final ScheduledExecutorService watchdog = Executors.newSingleThreadScheduledExecutor(task -> new Thread(task, "salon-update-deadline"));
    static final long CHECK_TIMEOUT_MILLIS = 15000;
    private final long checkTimeoutMillis;
    private final Object checkLock = new Object();
    private CheckOperation activeCheck;
    private final AtomicBoolean busy = new AtomicBoolean();
    private volatile boolean destroyed;
    private volatile HttpURLConnection connection;
    private volatile Metadata available;
    private volatile long checkedAt;

    private static final class CheckOperation {
        final String id;
        final long deadline;
        volatile boolean finished;
        volatile HttpURLConnection connection;
        volatile Future<?> worker;
        volatile String phase = "connecting";
        ScheduledFuture<?> timeout;
        CheckOperation(String id, long deadline) { this.id = id; this.deadline = deadline; }
    }

    private static ExecutorService boundedExecutor(String name) {
        return new ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS, new SynchronousQueue<>(),
            task -> new Thread(task, name), new ThreadPoolExecutor.AbortPolicy());
    }

    private static final class Metadata {
        final long code, size;
        final int minSdk;
        final String name, digest, notes;
        final URL url;
        Metadata(JSONObject json) throws Exception {
            code = UpdatePolicy.integer(json.get("versionCode"), 1, Integer.MAX_VALUE);
            name = UpdatePolicy.version(string(json, "versionName"));
            minSdk = (int)UpdatePolicy.integer(json.get("minSdk"), 26, 10000);
            size = UpdatePolicy.integer(json.get("size"), 1, UpdatePolicy.MAX_APK_BYTES);
            digest = UpdatePolicy.digest(string(json, "sha256"));
            notes = json.has("notes") ? string(json, "notes") : "";
            if (notes.length() > 4000) throw new IOException("Release notes too long");
            url = UpdatePolicy.apkUrl(string(json, "apkUrl"), name);
        }
        private static String string(JSONObject json, String key) throws Exception {
            Object value = json.get(key);
            if (!(value instanceof String)) throw new IOException("Update field must be text");
            return (String)value;
        }
    }

    AppUpdater(Activity activity, Listener listener) { this(activity, listener, CHECK_TIMEOUT_MILLIS); }

    // Package-only shorter deadline permits deterministic transport tests; callers cannot extend the limit.
    AppUpdater(Activity activity, Listener listener, long checkTimeoutMillis) {
        if (checkTimeoutMillis <= 0 || checkTimeoutMillis > CHECK_TIMEOUT_MILLIS)
            throw new IllegalArgumentException("Invalid update check deadline");
        this.activity = activity; this.listener = listener; this.checkTimeoutMillis = checkTimeoutMillis;
    }

    String info() {
        try {
            PackageInfo info = installed();
            return new JSONObject().put("versionCode", versionCode(info)).put("versionName", info.versionName).toString();
        } catch (Exception failure) { return "{}"; }
    }

    private PackageInfo installed() throws Exception {
        return activity.getPackageManager().getPackageInfo(activity.getPackageName(), signatureFlags());
    }

    private static int signatureFlags() {
        return Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
    }

    private static long versionCode(PackageInfo info) {
        return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
    }

    void check(String id) {
        if (!begin(id)) return;
        resultMailbox.started(id);
        final CheckOperation operation = new CheckOperation(id, SystemClock.elapsedRealtime() + checkTimeoutMillis);
        synchronized (checkLock) {
            if (destroyed) { busy.set(false); return; }
            activeCheck = operation;
            available = null;
            checkedAt = 0;
            operation.timeout = watchdog.schedule(() -> {
                if (finishCheck(operation, null, checkTimeoutResult(operation))) {
                    Future<?> worker = operation.worker;
                    if (worker != null) worker.cancel(true);
                    disconnectAsync(operation.connection);
                }
            }, checkTimeoutMillis, TimeUnit.MILLISECONDS);
        }
        try { operation.worker = metadataExecutor.submit(() -> {
            try {
                byte[] bytes = readMetadata(operation);
                operation.phase = "version";
                JSONTokener tokener = new JSONTokener(new String(bytes, StandardCharsets.UTF_8));
                Object parsed = tokener.nextValue();
                if (!(parsed instanceof JSONObject) || tokener.nextClean() != 0) throw new IOException("Invalid update metadata");
                Metadata metadata = new Metadata((JSONObject)parsed);
                long installedCode = versionCode(installed());
                if (metadata.code > installedCode && metadata.minSdk > Build.VERSION.SDK_INT)
                    throw new IOException("Unsupported Android version");
                finishCheck(operation, metadata.code > installedCode ? metadata : null, result(metadata.code > installedCode ? "available" : "current",
                    metadata.code > installedCode ? "Este disponibilă o versiune nouă." : "Ai deja cea mai nouă versiune.")
                    .put("versionCode", metadata.code).put("versionName", metadata.name).put("notes", metadata.notes));
            } catch (Exception failure) {
                finishCheck(operation, null, checkFailure(operation, failure));
            }
        });
        if (operation.finished) operation.worker.cancel(true);
        } catch (RejectedExecutionException occupied) {
            finishCheck(operation, null, result("error", "Verificarea anterioară încă se închide. Încearcă din nou în câteva secunde."));
        }
    }

    private static JSONObject checkTimeoutResult(CheckOperation operation) {
        String phase = operation.phase;
        String message = "version".equals(phase)
            ? "Actualizatorul Android nu a finalizat verificarea versiunii la timp. Închide și redeschide aplicația."
            : "Serverul de actualizări nu a răspuns la timp (" + ("reading".equals(phase) ? "citire" : "closing".equals(phase) ? "închidere conexiune" : "conectare") + "). Reîncearcă.";
        return diagnostic(operation, "timeout_" + phase, message);
    }

    private static final class MetadataHttpException extends IOException {
        final int status;
        MetadataHttpException(int status) { super("Metadata HTTP response"); this.status = status; }
    }

    private static JSONObject diagnostic(CheckOperation operation, String code, String message) {
        JSONObject value = result("error", message);
        try { value.put("code", code).put("phase", operation.phase); } catch (Exception ignored) {}
        return value;
    }

    private static JSONObject checkFailure(CheckOperation operation, Exception failure) {
        // Public reason codes only: never expose exception messages, URLs or TLS credentials.
        Throwable cause = failure;
        for (int depth = 0; cause != null && depth < 5; depth++, cause = cause.getCause()) {
            if (cause instanceof SSLException) return diagnostic(operation, "tls", "Telefonul nu a putut valida conexiunea securizată cu serverul de actualizări. Verifică data și ora telefonului.");
            if (cause instanceof UnknownHostException) return diagnostic(operation, "dns", "Telefonul nu a putut găsi serverul de actualizări (DNS). Verifică rețeaua și reîncearcă.");
            if (cause instanceof SocketTimeoutException) return diagnostic(operation, "network_timeout", "Serverul de actualizări nu a răspuns la timp. Reîncearcă.");
            if (cause instanceof MetadataHttpException) {
                int status = ((MetadataHttpException)cause).status;
                return diagnostic(operation, "http", status >= 100 && status <= 599
                    ? "Serverul de actualizări a răspuns cu HTTP " + status + ". Reîncearcă mai târziu."
                    : "Serverul de actualizări nu a trimis un răspuns HTTP valid. Reîncearcă.");
            }
            if (cause.getCause() == cause) break;
        }
        if ("version".equals(operation.phase)) return diagnostic(operation, "metadata", "Informațiile despre versiunea publicată nu au putut fi verificate. Reîncearcă mai târziu.");
        return diagnostic(operation, "network", "Nu am putut verifica actualizările. Verifică internetul și încearcă din nou.");
    }

    private boolean finishCheck(CheckOperation operation, Metadata metadata, JSONObject value) {
        synchronized (checkLock) {
            if (destroyed || activeCheck != operation || operation.finished) return false;
            operation.finished = true;
            activeCheck = null;
            if (operation.timeout != null) operation.timeout.cancel(false);
            if (SystemClock.elapsedRealtime() >= operation.deadline) { metadata = null; value = checkTimeoutResult(operation); }
            available = metadata;
            checkedAt = metadata == null ? 0 : SystemClock.elapsedRealtime();
            busy.set(false);
        }
        emit(operation.id, value);
        return true;
    }

    private void ensureCheckActive(CheckOperation operation) throws IOException {
        synchronized (checkLock) {
            if (destroyed || activeCheck != operation || operation.finished || Thread.currentThread().isInterrupted()
                    || SystemClock.elapsedRealtime() >= operation.deadline) throw new IOException("Update check interrupted");
        }
    }

    private void disconnectAsync(HttpURLConnection request) {
        disconnectAsync(request, null);
    }

    private void disconnectAsync(HttpURLConnection request, InputStream input) {
        if (request == null) return;
        try { disconnectExecutor.execute(() -> {
            try { if (input != null) input.close(); } catch (IOException ignored) {}
            finally { request.disconnect(); }
        }); } catch (RejectedExecutionException ignored) {}
    }

    void install(String id) {
        if (!begin(id)) return;
        resultMailbox.started(id);
        final Metadata metadata = available;
        try {
            if (metadata == null) throw new IOException("No checked update");
            UpdatePolicy.installUrl(metadata.url.toString(), metadata.name, metadata.code,
                versionCode(installed()), checkedAt, SystemClock.elapsedRealtime());
            if (metadata.minSdk > Build.VERSION.SDK_INT) throw new IOException("Unsupported Android version");
        } catch (Exception failure) {
            busy.set(false);
            emit(id, result("error", "Verifică mai întâi dacă există o actualizare nouă compatibilă."));
            return;
        }
        if (!activity.getPackageManager().canRequestPackageInstalls()) {
            try {
                activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + activity.getPackageName())));
                emit(id, result("permission", "Permite instalarea din Agenda Salon, apoi revino și apasă din nou Instalează actualizarea."));
            } catch (RuntimeException unavailable) {
                emit(id, result("error", "Permisiunea de instalare nu a fost acordată. O poți activa în setările Android pentru Agenda Salon, apoi reîncearcă."));
            } finally { busy.set(false); }
            return;
        }
        emit(id, result("downloading", "Se descarcă și se verifică actualizarea…"));
        executor.execute(() -> {
            File partial = null;
            try {
                File directory = UpdateApkProvider.directory(activity);
                if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("Update cache unavailable");
                partial = new File(directory, "download.part");
                File apk = new File(directory, metadata.digest + ".apk");
                if (apk.isFile()) {
                    try { verifyCached(metadata, apk); }
                    catch (Exception invalidCache) {
                        if (!apk.delete()) throw new IOException("Cannot discard invalid update cache");
                    }
                }
                if (!apk.isFile()) {
                    download(metadata, partial);
                    verifyArchive(metadata, partial);
                    if (!partial.renameTo(apk)) throw new IOException("Cannot finalize update cache");
                } else verifyArchive(metadata, apk);
                // Cleanup only updater-owned filenames inside this isolated cache, after verification.
                File[] cached = directory.listFiles();
                if (cached != null) for (File old : cached) {
                    if (!old.getName().equals(apk.getName()) && old.getName().matches("[a-f0-9]{64}\\.apk")) old.delete();
                }
                activity.runOnUiThread(() -> {
                    if (destroyed) return;
                    try {
                        Uri uri = UpdateApkProvider.uri(activity, metadata.digest);
                        Intent intent = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, UpdateApkProvider.MIME);
                        intent.setClipData(ClipData.newRawUri("Agenda Salon", uri));
                        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        activity.startActivity(intent);
                        emit(id, result("installer", "Confirmă instalarea în fereastra Android. Datele și setările se păstrează."));
                    } catch (RuntimeException failure) {
                        emit(id, result("error", "Instalatorul Android nu a putut fi deschis. Verifică permisiunea de instalare și reîncearcă."));
                    } finally { busy.set(false); }
                });
            } catch (Exception failure) {
                busy.set(false);
                emit(id, result("error", "Actualizarea nu a putut fi descărcată sau verificată. Versiunea instalată și datele au fost păstrate."));
            } finally {
                if (partial != null && partial.exists()) partial.delete();
            }
        });
    }

    private boolean begin(String id) {
        if (!validId(id) || destroyed) return false;
        if (!busy.compareAndSet(false, true)) {
            emit(id, result("error", "O verificare sau instalare este deja în curs."));
            return false;
        }
        return true;
    }

    private static boolean validId(String id) { return UpdateResultMailbox.validId(id); }

    void queueResult(String id) { resultMailbox.queued(id); }

    void rejectResult(String id, String message) {
        if (destroyed || !validId(id)) return;
        emit(id, result("error", message == null ? "Verificarea nu a putut fi pornită." : message.substring(0, Math.min(1000, message.length()))));
    }

    String resultFor(String id) { return resultMailbox.read(id); }

    private static JSONObject result(String status, String message) {
        JSONObject result = new JSONObject();
        try { result.put("status", status).put("message", message); } catch (Exception ignored) {}
        return result;
    }

    private void emit(String id, JSONObject result) {
        if (destroyed) return;
        if (!resultMailbox.publish(id, result)) return;
        activity.runOnUiThread(() -> { if (!destroyed) listener.result(id, result); });
    }

    private HttpURLConnection open(URL url, long deadline) throws Exception {
        for (int hop = 0; hop <= 5; hop++) {
            ensureActive(deadline);
            URL allowed = UpdatePolicy.networkUrl(url.toString());
            HttpURLConnection next = (HttpURLConnection)allowed.openConnection();
            connection = next;
            next.setInstanceFollowRedirects(false);
            int remaining = (int)Math.max(1, Math.min(15000, deadline - SystemClock.elapsedRealtime()));
            next.setConnectTimeout(Math.min(12000, remaining));
            next.setReadTimeout(remaining);
            next.setRequestProperty("User-Agent", "Agenda-Salon-Android");
            next.setRequestProperty("Accept-Encoding", "identity");
            int code;
            try { code = next.getResponseCode(); }
            catch (Exception failure) { next.disconnect(); throw failure; }
            if (code == HttpURLConnection.HTTP_OK) return next;
            String location = next.getHeaderField("Location");
            next.disconnect();
            if ((code != 301 && code != 302 && code != 303 && code != 307 && code != 308) || location == null)
                throw new IOException("Update server returned " + code);
            url = new URL(allowed, location);
        }
        throw new IOException("Too many update redirects");
    }

    private void ensureActive(long deadline) throws IOException {
        if (destroyed || Thread.currentThread().isInterrupted() || SystemClock.elapsedRealtime() > deadline)
            throw new IOException("Update interrupted");
    }

    private byte[] readMetadata(CheckOperation operation) throws Exception {
        ensureCheckActive(operation);
        HttpURLConnection request = (HttpURLConnection)UpdatePolicy.networkUrl(UpdatePolicy.METADATA_URL).openConnection();
        operation.connection = request;
        InputStream input = null;
        try {
            ensureCheckActive(operation);
            request.setInstanceFollowRedirects(false);
            request.setUseCaches(false);
            request.setConnectTimeout((int)Math.min(8000, checkTimeoutMillis));
            request.setReadTimeout((int)Math.min(8000, checkTimeoutMillis));
            request.setRequestProperty("User-Agent", "Agenda-Salon-Android");
            request.setRequestProperty("Accept-Encoding", "identity");
            request.setRequestProperty("Cache-Control", "no-cache");
            int responseCode = request.getResponseCode();
            if (responseCode != HttpURLConnection.HTTP_OK) throw new MetadataHttpException(responseCode);
            ensureCheckActive(operation);
            operation.phase = "reading";
            if (request.getContentLengthLong() > UpdatePolicy.MAX_METADATA_BYTES) throw new IOException("Metadata too large");
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            input = request.getInputStream();
            byte[] buffer = new byte[4096];
            int count;
            while ((count = input.read(buffer)) != -1) {
                ensureCheckActive(operation);
                if (output.size() + count > UpdatePolicy.MAX_METADATA_BYTES) throw new IOException("Metadata too large");
                output.write(buffer, 0, count);
            }
            ensureCheckActive(operation);
            operation.phase = "closing";
            return output.toByteArray();
        } finally { disconnectAsync(request, input); operation.connection = null; }
    }

    private void download(Metadata metadata, File destination) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + 180000;
        HttpURLConnection request = open(metadata.url, deadline);
        try {
            long contentLength = request.getContentLengthLong();
            if (contentLength != -1 && contentLength != metadata.size) throw new IOException("Unexpected APK length");
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            long size = 0;
            try (InputStream input = request.getInputStream(); FileOutputStream output = new FileOutputStream(destination)) {
                byte[] buffer = new byte[16384]; int count;
                while ((count = input.read(buffer)) != -1) {
                    ensureActive(deadline);
                    size += count;
                    if (size > metadata.size) throw new IOException("APK too large");
                    digest.update(buffer, 0, count);
                    output.write(buffer, 0, count);
                }
                output.getFD().sync();
            }
            ensureActive(deadline);
            UpdatePolicy.verifyIntegrity(metadata.size, size, metadata.digest, hex(digest.digest()));
        } finally { request.disconnect(); connection = null; }
    }

    private static void verifyCached(Metadata metadata, File file) throws Exception {
        if (file.length() != metadata.size || file.length() > UpdatePolicy.MAX_APK_BYTES) throw new IOException("Invalid cached APK size");
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new java.io.FileInputStream(file)) {
            byte[] buffer = new byte[16384]; int count;
            while ((count = input.read(buffer)) != -1) digest.update(buffer, 0, count);
        }
        UpdatePolicy.verifyIntegrity(metadata.size, file.length(), metadata.digest, hex(digest.digest()));
    }

    private static String hex(byte[] bytes) {
        StringBuilder text = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) text.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
        return text.toString();
    }

    private static Set<String> signers(PackageInfo info) throws Exception {
        Signature[] signatures = Build.VERSION.SDK_INT >= 28 && info.signingInfo != null
            ? info.signingInfo.getApkContentsSigners() : info.signatures;
        if (signatures == null || signatures.length == 0) throw new IOException("APK signer unavailable");
        Set<String> result = new HashSet<>();
        for (Signature signature : signatures) result.add(hex(MessageDigest.getInstance("SHA-256").digest(signature.toByteArray())));
        return result;
    }

    private void verifyArchive(Metadata metadata, File file) throws Exception {
        PackageInfo archive = activity.getPackageManager().getPackageArchiveInfo(file.getAbsolutePath(), signatureFlags());
        PackageInfo local = installed();
        if (archive == null || !activity.getPackageName().equals(archive.packageName)
                || versionCode(archive) != metadata.code || versionCode(archive) <= versionCode(local)
                || !metadata.name.equals(archive.versionName) || archive.applicationInfo == null
                || archive.applicationInfo.minSdkVersion > Build.VERSION.SDK_INT
                || archive.applicationInfo.minSdkVersion != metadata.minSdk
                || !signers(local).equals(signers(archive)))
            throw new IOException("APK does not match installed application");
    }

    void destroy() {
        CheckOperation check;
        synchronized (checkLock) {
            destroyed = true;
            resultMailbox.close();
            check = activeCheck;
            activeCheck = null;
            if (check != null) {
                check.finished = true;
                if (check.timeout != null) check.timeout.cancel(false);
                if (check.worker != null) check.worker.cancel(true);
            }
        }
        watchdog.shutdownNow();
        metadataExecutor.shutdownNow();
        if (check != null) disconnectAsync(check.connection);
        executor.shutdownNow();
        HttpURLConnection active = connection;
        disconnectAsync(active);
        disconnectExecutor.shutdown();
    }
}

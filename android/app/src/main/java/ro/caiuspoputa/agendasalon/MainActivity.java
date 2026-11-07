package ro.caiuspoputa.agendasalon;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.graphics.Color;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.provider.ContactsContract;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import android.window.OnBackInvokedCallback;

import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.io.Reader;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/** Offline test shell: local SQLite persistence and user-selected JSON backup files. */
public final class MainActivity extends Activity {
    private static final int EXPORT_BACKUP = 1001;
    private static final int IMPORT_BACKUP = 1002;
    private static final int PICK_CONTACT = 1003;
    private static final int PICK_LOGO_IMAGE = 1004;
    private static final int MAX_BACKUP_CHARS = 30 * 1024 * 1024;
    // Metadata may contain a server baseline, pre-join backup and queued edits together.
    private static final int MAX_DEVICE_BYTES = 96 * 1024 * 1024;
    private static final int MAX_REQUEST_BYTES = 30 * 1024 * 1024;
    private static final int MAX_RESPONSE_BYTES = 40 * 1024 * 1024;
    private static final String HOME = "file:///android_asset/index.html";
    private WebView webView;
    private SalonDatabase database;
    private AppUpdater appUpdater;
    private String pendingExport;
    private boolean documentPickerOpen;
    private boolean logoPickerOpen;
    private ValueCallback<Uri[]> pendingLogoCallback;
    private WebView pendingLogoWebView;
    private String pendingContactRequestId;
    private boolean contactResultReceived;
    private volatile CancellationSignal contactQueryCancellation;
    private OnBackInvokedCallback backCallback;
    private volatile boolean destroyed;
    private boolean activationReady, activationRedirecting;
    private volatile HttpURLConnection activeSyncConnection;
    private final ThreadPoolExecutor syncExecutor = new ThreadPoolExecutor(
        1, 1, 0L, TimeUnit.MILLISECONDS, new ArrayBlockingQueue<Runnable>(2),
        task -> new Thread(task, "salon-sync"));

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Open neither agenda, HA credentials nor WebView before installation activation.
        if (redirectForActivation()) return;
        activationReady = true;
        database = new SalonDatabase(this);
        appUpdater = new AppUpdater(this, this::deliverAppUpdateResult);
        FrameLayout container = new FrameLayout(this);
        container.setBackgroundColor(Color.rgb(250, 248, 245));
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(250, 248, 245));
        container.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        setContentView(container);
        if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        container.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets safe = insets.getInsets(
                    WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
            } else {
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
        container.requestApplyInsets();

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false); // Android assets remain available.
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setGeolocationEnabled(false);
        settings.setTextZoom(100);
        webView.addJavascriptInterface(new AndroidBridge(), "Android");
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                                       FileChooserParams parameters) {
                return showLogoFileChooser(view, callback, parameters);
            }
        });
        webView.setWebViewClient(new WebViewClient() {
            @Override public void onPageStarted(WebView view, String url, Bitmap favicon) {
                // A callback belongs to its original document, including same-URL reloads.
                if (view == webView) completeLogoPicker(null);
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (isHome(uri)) return false;
                if (request.isForMainFrame() && request.hasGesture()
                        && ("https://github.com/caiuspoputa-debug/agenda-salon/releases/download/v1.1.1/Agenda-Salon-Instalare.pdf".equals(uri.toString())
                        || "https://github.com/caiuspoputa-debug/agenda-salon/releases/download/v1.1.1/Agenda-Salon-Utilizare.pdf".equals(uri.toString()))) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    } catch (ActivityNotFoundException e) {
                        Toast.makeText(MainActivity.this, "Nu există un browser disponibil.", Toast.LENGTH_SHORT).show();
                    }
                    return true;
                }
                if ("tel".equals(uri.getScheme())) dialNumber(uri.getSchemeSpecificPart());
                return true;
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("file".equals(uri.getScheme()) && uri.getPath() != null
                        && uri.getPath().startsWith("/android_asset/")) return null;
                return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked",
                    java.util.Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
            }
        });
        webView.loadUrl(HOME);
        if (Build.VERSION.SDK_INT >= 33) {
            backCallback = this::handleBack;
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(0, backCallback);
        }
    }

    private boolean redirectForActivation() {
        if (ActivationStore.ready(this)) return false;
        activationReady = false;
        if (!destroyed && !activationRedirecting && !isFinishing()) {
            activationRedirecting = true;
            startActivity(new Intent(this, ActivationActivity.class));
        }
        finish();
        return true;
    }

    @Override protected void onResume() {
        super.onResume();
        // onResume also runs after an onCreate redirected without initialization.
        if (!activationReady || destroyed || isFinishing()) return;
        redirectForActivation();
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (!activationReady || redirectForActivation()) return;
    }

    private static boolean isHome(Uri uri) {
        return uri != null && HOME.equals(uri.toString());
    }

    private boolean trustedPage() {
        return webView != null && isHome(Uri.parse(webView.getUrl() == null ? "" : webView.getUrl()));
    }

    /** Only a user-selected, single raster image is exposed to this local document. */
    private static boolean isLogoImageChooser(WebChromeClient.FileChooserParams parameters) {
        if (parameters == null || parameters.getMode() != WebChromeClient.FileChooserParams.MODE_OPEN
                || parameters.isCaptureEnabled()) return false;
        String[] accepts = parameters.getAcceptTypes();
        if (accepts == null || accepts.length == 0) return false;
        boolean found = false;
        for (String accept : accepts) {
            if (accept == null || accept.trim().isEmpty()) return false;
            for (String token : accept.split(",", -1)) {
                String type = token.trim().toLowerCase(Locale.ROOT);
                if (!("image/png".equals(type) || "image/jpeg".equals(type) || "image/webp".equals(type)
                        || ".png".equals(type) || ".jpg".equals(type) || ".jpeg".equals(type) || ".webp".equals(type)))
                    return false;
                found = true;
            }
        }
        return found;
    }

    private boolean showLogoFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                         WebChromeClient.FileChooserParams parameters) {
        if (callback == null) return false;
        // A duplicate callback is still owned by its original outstanding picker.
        if (callback == pendingLogoCallback) return true;
        if (destroyed || isFinishing() || isDestroyed() || view != webView || !trustedPage()
                || !isLogoImageChooser(parameters) || documentPickerOpen || pendingContactRequestId != null) {
            try { callback.onReceiveValue(null); } catch (RuntimeException ignored) {}
            return true;
        }
        pendingLogoCallback = callback;
        pendingLogoWebView = view;
        documentPickerOpen = true;
        logoPickerOpen = true;
        try {
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("image/*");
            intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"image/png", "image/jpeg", "image/webp"});
            intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, false);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivityForResult(intent, PICK_LOGO_IMAGE);
        } catch (RuntimeException unavailable) {
            logoPickerOpen = false;
            documentPickerOpen = false;
            completeLogoPicker(null);
        }
        return true;
    }

    /** Clears ownership before invocation: cancellation, navigation and result cannot complete twice. */
    private void completeLogoPicker(Uri selected) {
        ValueCallback<Uri[]> callback = pendingLogoCallback;
        pendingLogoCallback = null;
        pendingLogoWebView = null;
        if (callback != null) {
            try { callback.onReceiveValue(selected == null ? null : new Uri[]{selected}); }
            catch (RuntimeException ignored) { /* The original document may already be gone. */ }
        }
    }

    private void handleLogoImageResult(int resultCode, Intent data) {
        if (!logoPickerOpen) return;
        logoPickerOpen = false;
        documentPickerOpen = false;
        Uri selected = null;
        try {
            if (!destroyed && !isFinishing() && !isDestroyed() && pendingLogoWebView == webView
                    && trustedPage() && resultCode == RESULT_OK && data != null) {
                Uri candidate = data.getData();
                android.content.ClipData clips = data.getClipData();
                boolean single = clips == null || clips.getItemCount() == 1
                    && candidate != null && candidate.equals(clips.getItemAt(0).getUri());
                if (single && candidate != null && "content".equals(candidate.getScheme())
                        && candidate.getAuthority() != null && !candidate.getAuthority().isEmpty()
                        && candidate.getFragment() == null && candidate.toString().length() <= 8192) {
                    String type = getContentResolver().getType(candidate);
                    if ("image/png".equals(type) || "image/jpeg".equals(type) || "image/webp".equals(type))
                        selected = candidate;
                }
            }
        } catch (RuntimeException invalid) { /* Invalid or no longer readable selected document. */ }
        completeLogoPicker(selected);
    }

    public final class AndroidBridge {
        @JavascriptInterface public String appUpdateInfo() {
            return appUpdater == null || destroyed ? "{}" : appUpdater.info();
        }

        @JavascriptInterface public void checkAppUpdate(String requestId) {
            final AppUpdater updater = appUpdater;
            if (destroyed || updater == null) return;
            updater.queueResult(requestId);
            runOnUiThread(() -> {
                if (destroyed) return;
                if (!trustedPage()) {
                    updater.rejectResult(requestId, "Verificarea Android nu poate porni din acest ecran. Redeschide aplicația.");
                    return;
                }
                updater.check(requestId);
            });
        }

        /** Public update state only; never calls WebView or waits on its UI thread. */
        @JavascriptInterface public String appUpdateResult(String requestId) {
            final AppUpdater updater = appUpdater;
            return destroyed || updater == null ? "" : updater.resultFor(requestId);
        }

        @JavascriptInterface public void installAppUpdate(String requestId) {
            final AppUpdater updater = appUpdater;
            if (destroyed || updater == null) return;
            updater.queueResult(requestId);
            runOnUiThread(() -> {
                if (destroyed) return;
                if (!trustedPage()) {
                    updater.rejectResult(requestId, "Actualizarea Android nu poate porni din acest ecran. Redeschide aplicația.");
                    return;
                }
                updater.install(requestId);
            });
        }

        @JavascriptInterface public String load() {
            try { return database.loadSnapshot(); }
            catch (RuntimeException failure) { return "{\"_storageError\":true}"; }
        }

        /** A raw business-only copy retained before the most recent app version change. */
        @JavascriptInterface public boolean hasUpdateBackup() {
            try { return database.hasUpdateBackup(); }
            catch (RuntimeException failure) { return false; }
        }

        @JavascriptInterface public String loadUpdateBackup() {
            try { return database.loadUpdateBackup(); }
            catch (RuntimeException failure) { return "{\"_storageError\":true}"; }
        }

        @JavascriptInterface public boolean save(String json) {
            try {
                validateJson(json);
                database.saveSnapshot(json);
                return true;
            } catch (Exception failure) { return false; }
        }

        /** Device identity, credentials and outbox never form part of a business backup. */
        @JavascriptInterface public String loadDevice() {
            try { return database.loadDevice(); }
            catch (RuntimeException failure) { return "{\"_storageError\":true}"; }
        }

        @JavascriptInterface public boolean saveDevice(String deviceJson) {
            try {
                validateDeviceJson(deviceJson);
                database.saveDevice(deviceJson);
                return true;
            } catch (Exception failure) { return false; }
        }

        /** Save business data and its corresponding outbox in one SQLite transaction. */
        @JavascriptInterface public boolean saveLocal(String stateJson, String deviceJson) {
            try {
                validateJson(stateJson);
                validateDeviceJson(deviceJson);
                database.saveLocal(stateJson, deviceJson);
                return true;
            } catch (Exception failure) { return false; }
        }

        @JavascriptInterface public void syncRequest(String requestId, String baseUrl, String path,
                                                     String token, String json) {
            runOnUiThread(() -> {
                if (destroyed || !trustedPage()) return;
                try {
                    syncExecutor.execute(() -> performSync(requestId, baseUrl, path, token, json));
                } catch (RejectedExecutionException busy) {
                    deliverSyncResponse(requestId, syncResult(false, 0, null,
                        "Sincronizarea este ocupată. Reîncearcă în câteva momente."));
                }
            });
        }

        @JavascriptInterface public void dial(String phone) {
            runOnUiThread(() -> { if (trustedPage()) dialNumber(phone); });
        }

        /** The system grants access to one selected phone row; no address-book permission is needed. */
        @JavascriptInterface public void pickContact(String requestId) {
            runOnUiThread(() -> {
                if (destroyed || !trustedPage()) return;
                if (requestId == null || requestId.isEmpty() || requestId.length() > 200) {
                    deliverContactResponse(requestId, contactResult("error", null, null,
                        "Selecția contactului nu a putut fi pornită. Reîncearcă."));
                    return;
                }
                // A repeated press for the same request receives only the eventual picker result.
                if (requestId.equals(pendingContactRequestId)) return;
                if (pendingContactRequestId != null || documentPickerOpen) {
                    deliverContactResponse(requestId, contactResult("error", null, null,
                        "Închide selectorul deja deschis și încearcă din nou."));
                    return;
                }
                pendingContactRequestId = requestId;
                contactResultReceived = false;
                try {
                    Intent intent = new Intent(Intent.ACTION_PICK);
                    intent.setDataAndType(ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                        ContactsContract.CommonDataKinds.Phone.CONTENT_TYPE);
                    startActivityForResult(intent, PICK_CONTACT);
                } catch (ActivityNotFoundException unavailable) {
                    finishContactRequest(requestId, contactResult("error", null, null,
                        "Nu este disponibilă o aplicație pentru alegerea unui contact. Completează datele manual."));
                } catch (RuntimeException denied) {
                    finishContactRequest(requestId, contactResult("error", null, null,
                        "Agenda dispozitivului nu a putut fi deschisă. Completează datele manual."));
                }
            });
        }

        @JavascriptInterface public void exportBackup(String json) {
            runOnUiThread(() -> {
                if (!trustedPage() || documentPickerOpen || pendingContactRequestId != null) return;
                try {
                    validateSize(json);
                    pendingExport = json;
                    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("application/json");
                    String stamp = new SimpleDateFormat("yyyy-MM-dd-HHmm", Locale.ROOT).format(new Date());
                    intent.putExtra(Intent.EXTRA_TITLE, "Agenda-Salon-backup-" + stamp + ".json");
                    documentPickerOpen = true;
                    startActivityForResult(intent, EXPORT_BACKUP);
                } catch (Exception failure) {
                    documentPickerOpen = false;
                    pendingExport = null;
                    showMessage("Nu am putut deschide salvarea copiei de siguranță.");
                }
            });
        }

        @JavascriptInterface public void importBackup() {
            runOnUiThread(() -> {
                if (!trustedPage() || documentPickerOpen || pendingContactRequestId != null) return;
                try {
                    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("*/*");
                    intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/json", "text/plain", "application/octet-stream"});
                    documentPickerOpen = true;
                    startActivityForResult(intent, IMPORT_BACKUP);
                } catch (ActivityNotFoundException failure) {
                    documentPickerOpen = false;
                    showMessage("Nu este disponibil un selector de fișiere.");
                }
            });
        }
    }

    private void dialNumber(String phone) {
        if (phone == null) return;
        String number = phone.replaceAll("[^0-9+*#]", "");
        if (number.length() == 0 || number.length() > 40) return;
        try { startActivity(new Intent(Intent.ACTION_DIAL, Uri.fromParts("tel", number, null))); }
        catch (ActivityNotFoundException failure) { showMessage("Acest dispozitiv nu are aplicație de telefon."); }
    }

    private static void validateSize(String json) {
        if (json == null || json.length() > MAX_BACKUP_CHARS) throw new IllegalArgumentException("Backup too large");
    }

    private static void validateJson(String json) throws Exception {
        validateSize(json);
        new JSONObject(json);
    }

    private static void validateDeviceJson(String json) throws Exception {
        if (json == null || json.length() > MAX_DEVICE_BYTES
                || json.getBytes(StandardCharsets.UTF_8).length > MAX_DEVICE_BYTES)
            throw new IllegalArgumentException("Device data too large");
        new JSONObject(json);
    }

    private static final class SyncEndpoint {
        final URL url;
        final String hostHeader;
        SyncEndpoint(URL url, String hostHeader) { this.url = url; this.hostHeader = hostHeader; }
    }

    /** Cleartext HTTP is confined to LAN/loopback/Tailscale; HTTPS uses platform TLS checks. */
    private static SyncEndpoint validateSyncEndpoint(String baseUrl, String path) throws Exception {
        if (!"/v1/register".equals(path) && !"/v1/sync".equals(path) && !"/v1/status".equals(path))
            throw new IllegalArgumentException("Unsupported endpoint");
        if (baseUrl == null || baseUrl.length() > 2048) throw new IllegalArgumentException("Invalid URL");
        URI base = new URI(baseUrl.trim());
        String scheme = base.getScheme() == null ? "" : base.getScheme().toLowerCase(Locale.ROOT);
        String host = base.getHost();
        String rootPath = base.getRawPath();
        if ((!"https".equals(scheme) && !"http".equals(scheme)) || host == null
                || base.getRawUserInfo() != null || base.getRawQuery() != null || base.getRawFragment() != null
                || (rootPath != null && !rootPath.isEmpty() && !"/".equals(rootPath))
                || base.getPort() == 0 || base.getPort() < -1 || base.getPort() > 65535)
            throw new IllegalArgumentException("Invalid URL");
        if (host.startsWith("[") && host.endsWith("]")) host = host.substring(1, host.length() - 1);
        if (host.indexOf('%') >= 0) throw new IllegalArgumentException("Scoped hosts are unsupported");
        if ("https".equals(scheme))
            return new SyncEndpoint(new URI(scheme, null, host, base.getPort(), path, null, null).toURL(), null);

        String normalized = host.toLowerCase(Locale.ROOT);
        if (normalized.endsWith(".")) normalized = normalized.substring(0, normalized.length() - 1);
        boolean namedLocal = normalized.equals("localhost") || normalized.endsWith(".local")
            || normalized.endsWith(".ts.net");
        boolean numeric = isIpv4Literal(normalized) || normalized.indexOf(':') >= 0;
        if (!namedLocal && !numeric) throw new IllegalArgumentException("Public cleartext host");
        InetAddress[] addresses = InetAddress.getAllByName(normalized);
        if (addresses.length == 0) throw new IOException("Unresolved host");
        for (InetAddress address : addresses) {
            if (!isPrivateSyncAddress(address)) throw new IllegalArgumentException("Public cleartext address");
        }
        // Pin the resolved private address so a second DNS lookup cannot redirect credentials publicly.
        InetAddress selected = addresses[0];
        for (InetAddress address : addresses) {
            if (address.getAddress().length == 4) { selected = address; break; }
        }
        String originalHost = host.indexOf(':') >= 0 ? "[" + host + "]" : host;
        String authority = originalHost + (base.getPort() == -1 ? "" : ":" + base.getPort());
        return new SyncEndpoint(new URI("http", null, selected.getHostAddress(), base.getPort(), path, null, null).toURL(), authority);
    }

    private static boolean isIpv4Literal(String host) {
        String[] parts = host.split("\\.", -1);
        if (parts.length != 4) return false;
        for (String part : parts) {
            if (!part.matches("[0-9]{1,3}") || (part.length() > 1 && part.charAt(0) == '0')) return false;
            if (Integer.parseInt(part) > 255) return false;
        }
        return true;
    }

    private static boolean isPrivateSyncAddress(InetAddress address) {
        byte[] raw = address.getAddress();
        if (raw.length == 4) {
            int first = raw[0] & 255, second = raw[1] & 255;
            return first == 10 || first == 127 || (first == 172 && second >= 16 && second <= 31)
                || (first == 192 && second == 168) || (first == 169 && second == 254)
                || (first == 100 && second >= 64 && second <= 127);
        }
        return address.isLoopbackAddress() || address.isLinkLocalAddress()
            || (raw.length == 16 && (raw[0] & 254) == 252);
    }

    private void performSync(String requestId, String baseUrl, String path, String token, String json) {
        HttpURLConnection connection = null;
        int status = 0;
        JSONObject response;
        try {
            if (destroyed || Thread.currentThread().isInterrupted()) return;
            SyncEndpoint endpoint = validateSyncEndpoint(baseUrl, path);
            if (token != null && (token.length() > 8192 || !token.matches("[\\x21-\\x7E]*")))
                throw new IllegalArgumentException("Invalid authorization");
            String payload = json == null || json.trim().isEmpty() ? "{}" : json;
            if (payload.length() > MAX_REQUEST_BYTES) throw new IllegalArgumentException("Request too large");
            new JSONObject(payload);
            byte[] bytes = payload.getBytes(StandardCharsets.UTF_8);
            if (bytes.length > MAX_REQUEST_BYTES) throw new IllegalArgumentException("Request too large");
            if (destroyed || Thread.currentThread().isInterrupted()) return;
            connection = (HttpURLConnection) endpoint.url.openConnection(java.net.Proxy.NO_PROXY);
            activeSyncConnection = connection;
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(10000);
            connection.setReadTimeout(15000);
            connection.setUseCaches(false);
            connection.setRequestMethod("POST");
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Accept-Encoding", "identity");
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            if (endpoint.hostHeader != null) connection.setRequestProperty("Host", endpoint.hostHeader);
            if (token != null && !token.isEmpty()) connection.setRequestProperty("Authorization", "Bearer " + token);
            connection.setDoOutput(true);
            connection.setFixedLengthStreamingMode(bytes.length);
            if (destroyed || Thread.currentThread().isInterrupted()) return;
            try (OutputStream output = connection.getOutputStream()) { output.write(bytes); }
            status = connection.getResponseCode();
            long contentLength = connection.getContentLengthLong();
            if (contentLength > MAX_RESPONSE_BYTES) throw new IOException("Response too large");
            InputStream input = status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream();
            Object body = null;
            if (input != null) {
                String text;
                try (InputStream incoming = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    byte[] buffer = new byte[8192];
                    int count;
                    while ((count = incoming.read(buffer)) != -1) {
                        if (output.size() + count > MAX_RESPONSE_BYTES) throw new IOException("Response too large");
                        if (destroyed || Thread.currentThread().isInterrupted()) return;
                        output.write(buffer, 0, count);
                    }
                    text = new String(output.toByteArray(), StandardCharsets.UTF_8);
                }
                if (!text.trim().isEmpty()) {
                    JSONTokener parser = new JSONTokener(text);
                    body = parser.nextValue();
                    if (parser.nextClean() != 0) throw new IOException("Invalid JSON response");
                }
            }
            boolean ok = status >= 200 && status < 300;
            response = syncResult(ok, status, body, ok ? "" : "Serverul a respins cererea de sincronizare.");
        } catch (IllegalArgumentException invalid) {
            response = syncResult(false, status, null, "Adresa serverului sau datele de sincronizare nu sunt valide ori permise.");
        } catch (Exception unavailable) {
            response = syncResult(false, status, null, "Serverul nu poate fi contactat sau a trimis un răspuns invalid. Datele rămân salvate local.");
        } finally {
            if (connection != null) connection.disconnect();
            activeSyncConnection = null;
        }
        deliverSyncResponse(requestId, response);
    }

    private static JSONObject syncResult(boolean ok, int status, Object body, String error) {
        JSONObject result = new JSONObject();
        try {
            result.put("ok", ok);
            result.put("status", status);
            result.put("body", body == null ? JSONObject.NULL : body);
            result.put("error", error);
        } catch (org.json.JSONException impossible) { throw new IllegalStateException(impossible); }
        return result;
    }

    private void deliverSyncResponse(String requestId, JSONObject response) {
        if (destroyed) return;
        runOnUiThread(() -> {
            if (destroyed || !trustedPage()) return;
            String callback = "(function(){if(typeof window.salonSyncResponse==='function'){window.salonSyncResponse("
                + JSONObject.quote(requestId == null ? "" : requestId) + "," + JSONObject.quote(response.toString()) + ");}})()";
            webView.evaluateJavascript(callback, null);
        });
    }

    /** Accept only a selected row from the platform Contacts Provider, never a collection or file URI. */
    private static boolean isSelectedPhoneUri(Uri uri) {
        if (uri == null || !"content".equals(uri.getScheme()) || uri.getQuery() != null || uri.getFragment() != null)
            return false;
        String authority = uri.getEncodedAuthority();
        String path = uri.getEncodedPath();
        return authority != null && authority.matches("(?:[0-9]+@)?com\\.android\\.contacts")
            && path != null && path.matches("/data/(?:(?:phones|phones_enterprise)/)?[0-9]+");
    }

    private static JSONObject contactResult(String status, String name, String phone, String error) {
        JSONObject result = new JSONObject();
        try {
            result.put("status", status);
            if ("selected".equals(status)) {
                JSONObject contact = new JSONObject();
                contact.put("name", name);
                contact.put("phone", phone);
                result.put("contact", contact);
            }
            if ("error".equals(status)) result.put("error", error);
        } catch (org.json.JSONException impossible) { throw new IllegalStateException(impossible); }
        return result;
    }

    private void deliverContactResponse(String requestId, JSONObject payload) {
        if (destroyed || !trustedPage()) return;
        String script = "(function(){if(typeof window.salonContactResult==='function'){window.salonContactResult("
            + JSONObject.quote(requestId == null ? "" : requestId) + "," + JSONObject.quote(payload.toString()) + ");}})()";
        webView.evaluateJavascript(script, null);
    }

    private void finishContactRequest(String requestId, JSONObject payload) {
        runOnUiThread(() -> {
            if (!requestId.equals(pendingContactRequestId)) return;
            pendingContactRequestId = null;
            contactQueryCancellation = null;
            deliverContactResponse(requestId, payload);
        });
    }

    private void handleContactResult(int resultCode, Intent data) {
        final String requestId = pendingContactRequestId;
        if (requestId == null || contactResultReceived || destroyed) return;
        contactResultReceived = true;
        if (resultCode != RESULT_OK) {
            finishContactRequest(requestId, contactResult("cancelled", null, null, null));
            return;
        }
        final Uri selected = data == null ? null : data.getData();
        if (!isSelectedPhoneUri(selected)) {
            finishContactRequest(requestId, contactResult("error", null, null,
                "Contactul ales nu poate fi citit în siguranță. Completează numele și telefonul manual."));
            return;
        }
        final CancellationSignal cancellation = new CancellationSignal();
        contactQueryCancellation = cancellation;
        new Thread(() -> {
            JSONObject result;
            try {
                if (destroyed) return;
                String[] projection = {ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                    ContactsContract.CommonDataKinds.Phone.NUMBER};
                try (Cursor cursor = getContentResolver().query(selected, projection, null, null, null, cancellation)) {
                    if (cursor == null || cursor.getCount() != 1 || !cursor.moveToFirst())
                        throw new IOException("Selected contact is unavailable");
                    String name = cursor.getString(cursor.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME));
                    String phone = cursor.getString(cursor.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Phone.NUMBER));
                    name = name == null ? "" : name.trim();
                    phone = phone == null ? "" : phone.trim();
                    if (name.length() > 1024 || phone.isEmpty() || phone.length() > 256)
                        throw new IOException("Selected contact is invalid");
                    result = contactResult("selected", name, phone, null);
                }
            } catch (Exception failure) {
                result = contactResult("error", null, null,
                    "Datele contactului ales nu au putut fi citite. Completează numele și telefonul manual.");
            }
            finishContactRequest(requestId, result);
        }, "salon-contact-picker").start();
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == PICK_LOGO_IMAGE) { handleLogoImageResult(resultCode, data); return; }
        if (requestCode == PICK_CONTACT) { handleContactResult(resultCode, data); return; }
        if (requestCode != EXPORT_BACKUP && requestCode != IMPORT_BACKUP) return;
        documentPickerOpen = false;
        if (resultCode != RESULT_OK || data == null || data.getData() == null) {
            pendingExport = null;
            return;
        }
        Uri uri = data.getData();
        if (requestCode == EXPORT_BACKUP) {
            final String snapshot = pendingExport;
            pendingExport = null;
            new Thread(() -> {
                try {
                    String json = snapshot != null ? snapshot : database.loadSnapshot();
                    validateSize(json);
                    try (OutputStream output = getContentResolver().openOutputStream(uri, "wt")) {
                        if (output == null) throw new java.io.IOException("No output stream");
                        try (OutputStreamWriter writer = new OutputStreamWriter(output, StandardCharsets.UTF_8)) { writer.write(json); }
                    }
                    runOnUiThread(() -> showMessage("Copia de siguranță a fost salvată."));
                } catch (Exception failure) {
                    runOnUiThread(() -> showMessage("Copia de siguranță nu a putut fi salvată."));
                }
            }, "salon-backup-export").start();
        } else {
            new Thread(() -> {
                try {
                    StringBuilder json = new StringBuilder();
                    try (InputStream input = getContentResolver().openInputStream(uri)) {
                        if (input == null) throw new java.io.IOException("No input stream");
                        try (Reader reader = new InputStreamReader(input, StandardCharsets.UTF_8)) {
                            char[] chunk = new char[8192];
                            int count;
                            while ((count = reader.read(chunk)) != -1) {
                                if (json.length() + count > MAX_BACKUP_CHARS) throw new java.io.IOException("Backup too large");
                                json.append(chunk, 0, count);
                            }
                        }
                    }
                    final String text = json.toString();
                    validateJson(text);
                    runOnUiThread(() -> {
                        if (!trustedPage()) return;
                        String script = "(function(){if(typeof window.restoreBackup==='function'){window.restoreBackup("
                            + JSONObject.quote(text) + ");return true;}return false;})()";
                        webView.evaluateJavascript(script, result -> {
                            if (!"true".equals(result)) showMessage("Restaurarea nu este disponibilă în această pagină.");
                        });
                    });
                } catch (Exception failure) {
                    runOnUiThread(() -> showMessage("Fișierul nu poate fi citit sau nu este un backup JSON valid."));
                }
            }, "salon-backup-import").start();
        }
    }

    private void deliverAppUpdateResult(String requestId, JSONObject result) {
        if (destroyed || !trustedPage()) return;
        webView.evaluateJavascript("(function(){if(typeof window.onAppUpdateResult==='function'){window.onAppUpdateResult("
            + JSONObject.quote(requestId) + "," + result.toString().replace("\u2028", "\\u2028").replace("\u2029", "\\u2029") + ");}})()", null);
    }

    private void showMessage(String text) { Toast.makeText(this, text, Toast.LENGTH_LONG).show(); }

    @Override public void onBackPressed() { handleBack(); }

    private void handleBack() {
        if (!trustedPage()) { finish(); return; }
        webView.evaluateJavascript("(function(){try{return typeof window.handleAndroidBack==='function' && window.handleAndroidBack()===true;}catch(e){return false;}})()",
            handled -> { if (!"true".equals(handled)) finish(); });
    }

    @Override protected void onDestroy() {
        destroyed = true;
        completeLogoPicker(null);
        logoPickerOpen = false;
        documentPickerOpen = false;
        if (appUpdater != null) appUpdater.destroy();
        pendingContactRequestId = null;
        CancellationSignal contactCancellation = contactQueryCancellation;
        contactQueryCancellation = null;
        if (contactCancellation != null) contactCancellation.cancel();
        syncExecutor.shutdownNow();
        HttpURLConnection connection = activeSyncConnection;
        if (connection != null) connection.disconnect();
        if (Build.VERSION.SDK_INT >= 33 && backCallback != null)
            getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backCallback);
        if (webView != null) {
            webView.removeJavascriptInterface("Android");
            webView.destroy();
            webView = null;
        }
        // SQLiteOpenHelper keeps application-owned data; closing a view does not delete it.
        super.onDestroy();
    }

    private static final class SalonDatabase extends SQLiteOpenHelper {
        private final long releaseVersion;

        SalonDatabase(Context context) {
            super(context.getApplicationContext(), "salon.db", null, 3);
            try {
                PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
                releaseVersion = Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
            } catch (PackageManager.NameNotFoundException failure) {
                throw new IllegalStateException("Installed app version could not be read", failure);
            }
        }

        @Override public void onCreate(SQLiteDatabase db) {
            db.execSQL("CREATE TABLE app_snapshot (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL, updated_at INTEGER NOT NULL)");
            createDeviceTable(db);
            createRecoveryTables(db);
        }

        @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
            if (oldVersion < 2) createDeviceTable(db);
            if (oldVersion < 3) createRecoveryTables(db);
        }

        @Override public void onOpen(SQLiteDatabase db) {
            super.onOpen(db);
            prepareRelease(db);
        }

        private static void createDeviceTable(SQLiteDatabase db) {
            db.execSQL("CREATE TABLE IF NOT EXISTS local_device (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL, updated_at INTEGER NOT NULL)");
        }

        private static void createRecoveryTables(SQLiteDatabase db) {
            db.execSQL("CREATE TABLE IF NOT EXISTS update_recovery (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL, version_code INTEGER NOT NULL, updated_at INTEGER NOT NULL)");
            db.execSQL("CREATE TABLE IF NOT EXISTS app_release (id INTEGER PRIMARY KEY CHECK(id=1), version_code INTEGER NOT NULL, updated_at INTEGER NOT NULL)");
        }

        /** Copy raw business JSON and advance the version marker atomically, before any app access. */
        private void prepareRelease(SQLiteDatabase db) {
            boolean ownsTransaction = !db.inTransaction();
            if (ownsTransaction) db.beginTransaction();
            try {
                boolean current;
                try (Cursor cursor = db.rawQuery("SELECT version_code FROM app_release WHERE id=1", null)) {
                    current = cursor.moveToFirst() && cursor.getLong(0) == releaseVersion;
                }
                if (!current) {
                    long now = System.currentTimeMillis();
                    // Zero rows leaves any previous recovery copy intact on an empty database.
                    db.execSQL("INSERT OR REPLACE INTO update_recovery (id,json,version_code,updated_at) SELECT 1,json,?,? FROM app_snapshot WHERE id=1",
                        new Object[]{releaseVersion, now});
                    db.execSQL("INSERT OR REPLACE INTO app_release (id,version_code,updated_at) VALUES (1,?,?)",
                        new Object[]{releaseVersion, now});
                }
                if (ownsTransaction) db.setTransactionSuccessful();
            } finally {
                if (ownsTransaction) db.endTransaction();
            }
        }

        synchronized String loadSnapshot() {
            return readJson("app_snapshot", MAX_BACKUP_CHARS);
        }

        synchronized boolean hasUpdateBackup() {
            SQLiteDatabase db = getReadableDatabase();
            try (Cursor cursor = db.rawQuery("SELECT 1 FROM update_recovery WHERE id=1", null)) {
                return cursor.moveToFirst();
            }
        }

        synchronized String loadUpdateBackup() {
            return readJson("update_recovery", MAX_BACKUP_CHARS);
        }

        synchronized void saveSnapshot(String json) {
            SQLiteDatabase db = getWritableDatabase();
            db.beginTransaction();
            try {
                prepareRelease(db);
                writeRow(db, "app_snapshot", json);
                db.setTransactionSuccessful();
            } finally { db.endTransaction(); }
        }

        synchronized String loadDevice() {
            return readJson("local_device", MAX_DEVICE_BYTES);
        }

        /** Avoid the small CursorWindow limit on Android 8 while reading one consistent snapshot. */
        private String readJson(String table, int maxCharacters) {
            SQLiteDatabase db = getReadableDatabase();
            db.beginTransactionNonExclusive();
            try {
                int characters;
                try (Cursor cursor = db.rawQuery("SELECT length(json) FROM " + table + " WHERE id=1", null)) {
                    if (!cursor.moveToFirst()) { db.setTransactionSuccessful(); return ""; }
                    characters = cursor.getInt(0);
                }
                if (characters < 0 || characters > maxCharacters)
                    throw new IllegalStateException("Stored JSON is too large");
                final int chunkCharacters = 128 * 1024;
                StringBuilder result = new StringBuilder(Math.min(characters, chunkCharacters));
                for (int offset = 1; offset <= characters; offset += chunkCharacters) {
                    try (Cursor cursor = db.rawQuery("SELECT substr(json, ?, ?) FROM " + table + " WHERE id=1",
                            new String[]{Integer.toString(offset), Integer.toString(chunkCharacters)})) {
                        if (!cursor.moveToFirst()) throw new IllegalStateException("Stored JSON disappeared");
                        result.append(cursor.getString(0));
                    }
                }
                db.setTransactionSuccessful();
                return result.toString();
            } finally { db.endTransaction(); }
        }

        synchronized void saveDevice(String json) {
            SQLiteDatabase db = getWritableDatabase();
            db.beginTransaction();
            try {
                prepareRelease(db);
                writeRow(db, "local_device", json);
                db.setTransactionSuccessful();
            } finally { db.endTransaction(); }
        }

        synchronized void saveLocal(String stateJson, String deviceJson) {
            SQLiteDatabase db = getWritableDatabase();
            db.beginTransaction();
            try {
                prepareRelease(db);
                writeRow(db, "app_snapshot", stateJson);
                writeRow(db, "local_device", deviceJson);
                db.setTransactionSuccessful();
            } finally { db.endTransaction(); }
        }

        private static void writeRow(SQLiteDatabase db, String table, String json) {
            ContentValues values = new ContentValues();
            values.put("id", 1);
            values.put("json", json);
            values.put("updated_at", System.currentTimeMillis());
            if (db.insertWithOnConflict(table, null, values, SQLiteDatabase.CONFLICT_REPLACE) == -1)
                throw new IllegalStateException("Local write failed");
        }
    }
}

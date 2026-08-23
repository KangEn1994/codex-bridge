package com.codexbridge.mobile;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.annotation.TargetApi;
import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.content.pm.PackageManager;
import android.util.Base64;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.SafeBrowsingResponse;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.ValueCallback;
import android.provider.MediaStore;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import java.net.URI;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Locale;

import org.json.JSONException;
import org.json.JSONObject;

public final class MainActivity extends Activity {
    private static final String PREFERENCES = "codex_bridge";
    private static final String URL_KEY = "bridge_url";
    private static final String WEBVIEW_VERSION_KEY = "webview_version";
    private static final String NOTIFICATION_PERMISSION_ASKED_KEY = "notification_permission_asked";
    private static final String NOTIFICATION_CHANNEL = "codex_events";
    private static final int CONNECTION_NOTIFICATION_ID = 4101;
    private static final int NOTIFICATION_PERMISSION_REQUEST = 42;
    private static final int SCANNER_REQUEST = 74;
    private static final int IMAGE_PICKER_REQUEST = 75;
    private static final int CONNECTION_REQUEST = 76;
    private static final int NATIVE_BRIDGE_PROTOCOL = 1;
    private static final int MIN_CONNECTION_PASSWORD_LENGTH = 12;
    private static final int MIN_PAIRING_CODE_LENGTH = 20;
    private static final String NATIVE_MESSAGE_OBJECT = "CodexBridgeNative";

    private WebView webView;
    private String bridgeUrl;
    private boolean settingsVisible;
    private boolean mainFrameLoadFailed;
    private boolean nativeMessageBridgeInstalled;
    private ValueCallback<Uri[]> pendingFileCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        bridgeUrl = getSharedPreferences(PREFERENCES, MODE_PRIVATE)
            .getString(URL_KEY, BuildConfig.DEFAULT_BRIDGE_URL);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(11, 13, 16));
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, windowInsets) -> {
            Insets systemBars = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            Insets keyboard = windowInsets.getInsets(WindowInsetsCompat.Type.ime());
            view.setPadding(
                systemBars.left,
                systemBars.top,
                systemBars.right,
                Math.max(systemBars.bottom, keyboard.bottom)
            );
            return WindowInsetsCompat.CONSUMED;
        });
        webView = new WebView(this);
        root.addView(webView, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));

        setContentView(root);
        ViewCompat.requestApplyInsets(root);
        configureNotificationChannel();
        configureWebView();
        refreshWebShellAfterNativeUpgrade();
        String launchUrl = resolveLaunchUrl(getIntent());
        configureNativeMessageBridge();
        loadBridgeOrShowPairing(launchUrl);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String launchUrl = resolveLaunchUrl(intent);
        configureNativeMessageBridge();
        loadBridgeOrShowPairing(launchUrl);
    }

    private void loadBridgeOrShowPairing(String launchUrl) {
        if (normalizeUrl(launchUrl) == null) {
            webView.post(() -> showConnectionScreen());
            return;
        }
        webView.loadUrl(versionedLaunchUrl(launchUrl));
    }

    private void refreshWebShellAfterNativeUpgrade() {
        int previousVersion = getSharedPreferences(PREFERENCES, MODE_PRIVATE)
            .getInt(WEBVIEW_VERSION_KEY, 0);
        if (previousVersion == BuildConfig.VERSION_CODE) return;
        webView.clearCache(true);
        getSharedPreferences(PREFERENCES, MODE_PRIVATE).edit()
            .putInt(WEBVIEW_VERSION_KEY, BuildConfig.VERSION_CODE)
            .apply();
    }

    private String versionedLaunchUrl(String url) {
        return Uri.parse(url).buildUpon()
            .appendQueryParameter("nativeApp", BuildConfig.VERSION_NAME)
            .build()
            .toString();
    }

    private String resolveLaunchUrl(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        if (data == null || !"codexbridge".equalsIgnoreCase(data.getScheme())) return bridgeUrl;
        if ("task".equalsIgnoreCase(data.getHost())) {
            String threadId = value(data.getQueryParameter("id"));
            return threadId.isEmpty() ? bridgeUrl : bridgeUrl + "/#thread=" + Uri.encode(threadId);
        }
        if (!"pair".equalsIgnoreCase(data.getHost())) return bridgeUrl;
        String server = normalizeUrl(value(data.getQueryParameter("server")));
        String token = data.getQueryParameter("token");
        String code = data.getQueryParameter("code");
        if (server == null ||
            ((token == null || token.length() < MIN_CONNECTION_PASSWORD_LENGTH) &&
            (code == null || code.length() < MIN_PAIRING_CODE_LENGTH))) return bridgeUrl;
        bridgeUrl = server;
        getSharedPreferences(PREFERENCES, MODE_PRIVATE).edit().putString(URL_KEY, bridgeUrl).apply();
        try {
            JSONObject pairing = new JSONObject().put("server", server);
            if (code != null) pairing.put("code", code);
            else pairing.put("token", token);
            String payload = Base64.encodeToString(
                pairing.toString().getBytes(StandardCharsets.UTF_8),
                Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING
            );
            return pairingLaunchUrl(bridgeUrl, payload);
        } catch (JSONException error) {
            return bridgeUrl;
        }
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        settings.setUserAgentString(settings.getUserAgentString() + " CodexBridgeAndroid/" + BuildConfig.VERSION_NAME);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        webView.addJavascriptInterface(new NativeBridge(), "CodexBridgeAndroid");
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                WebView view,
                ValueCallback<Uri[]> callback,
                FileChooserParams fileChooserParams
            ) {
                if (pendingFileCallback != null) pendingFileCallback.onReceiveValue(null);
                pendingFileCallback = callback;
                Intent picker;
                if (Build.VERSION.SDK_INT >= 33) {
                    picker = new Intent(MediaStore.ACTION_PICK_IMAGES)
                        .setType("image/*")
                        .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                        .putExtra(MediaStore.EXTRA_PICK_IMAGES_MAX, 4);
                } else {
                    picker = new Intent(Intent.ACTION_OPEN_DOCUMENT)
                        .addCategory(Intent.CATEGORY_OPENABLE)
                        .setType("image/*")
                        .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                }
                try {
                    startActivityForResult(picker, IMAGE_PICKER_REQUEST);
                } catch (ActivityNotFoundException error) {
                    pendingFileCallback = null;
                    callback.onReceiveValue(null);
                    Toast.makeText(MainActivity.this, "无法打开系统相册", Toast.LENGTH_LONG).show();
                }
                return true;
            }
        });

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                mainFrameLoadFailed = false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                String normalizedBridge = normalizeUrl(bridgeUrl);
                if (!mainFrameLoadFailed && normalizedBridge != null &&
                    sameOrigin(Uri.parse(normalizedBridge), Uri.parse(url))) {
                    requestNotificationPermissionIfNeeded();
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri target = request.getUrl();
                if (sameOrigin(Uri.parse(bridgeUrl), target)) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, target));
                } catch (ActivityNotFoundException error) {
                    Toast.makeText(MainActivity.this, target.toString(), Toast.LENGTH_LONG).show();
                }
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    mainFrameLoadFailed = true;
                    Toast.makeText(MainActivity.this, R.string.page_unavailable, Toast.LENGTH_LONG).show();
                    view.postDelayed(() -> showConnectionScreen(), 250);
                }
            }

            @Override
            @TargetApi(27)
            public void onSafeBrowsingHit(WebView view, WebResourceRequest request, int threatType, SafeBrowsingResponse callback) {
                callback.backToSafety(true);
            }
        });
    }

    private final class NativeBridge {
        @JavascriptInterface
        public String getDeviceName() {
            String manufacturer = value(Build.MANUFACTURER).trim();
            String model = value(Build.MODEL).trim();
            if (manufacturer.isEmpty()) return model.isEmpty() ? "Android device" : model;
            if (model.toLowerCase(Locale.ROOT).startsWith(manufacturer.toLowerCase(Locale.ROOT))) return model;
            return manufacturer + " " + model;
        }

        @JavascriptInterface
        public void scanPairingCode() {
            runOnUiThread(() -> startPairingScan());
        }

        @JavascriptInterface
        public void copyText(String text) {
            ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            clipboard.setPrimaryClip(ClipData.newPlainText("Codex Bridge", text == null ? "" : text));
        }

        @JavascriptInterface
        public void openImage(String url, String token, String title) {
            runOnUiThread(() -> openNativeImage(url, url + "?variant=preview", token, title));
        }

        @JavascriptInterface
        public void notify(String title, String body, String threadId) {
            runOnUiThread(() -> showNotification(title, body, threadId));
        }

        @JavascriptInterface
        public void notifyConnectionIssue(String body) {
            runOnUiThread(() -> showNotification(
                "电脑已离线",
                body,
                "",
                CONNECTION_NOTIFICATION_ID
            ));
        }

        @JavascriptInterface
        public void dismissConnectionIssue() {
            runOnUiThread(() -> ((NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE))
                .cancel(CONNECTION_NOTIFICATION_ID));
        }
    }

    private void configureNativeMessageBridge() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return;
        if (nativeMessageBridgeInstalled) {
            WebViewCompat.removeWebMessageListener(webView, NATIVE_MESSAGE_OBJECT);
            nativeMessageBridgeInstalled = false;
        }
        Uri bridge = Uri.parse(bridgeUrl);
        String origin = value(bridge.getScheme()) + "://" + value(bridge.getEncodedAuthority());
        if (bridge.getHost() == null || origin.endsWith("://")) return;
        WebViewCompat.addWebMessageListener(
            webView,
            NATIVE_MESSAGE_OBJECT,
            Collections.singleton(origin),
            (view, message, sourceOrigin, isMainFrame, replyProxy) ->
                handleNativeMessage(message, sourceOrigin, isMainFrame, replyProxy)
        );
        nativeMessageBridgeInstalled = true;
    }

    private void handleNativeMessage(
        WebMessageCompat message,
        Uri sourceOrigin,
        boolean isMainFrame,
        JavaScriptReplyProxy replyProxy
    ) {
        String requestId = "";
        String replyType = "error";
        boolean ok = false;
        String error = "不支持的请求";
        try {
            JSONObject request = new JSONObject(value(message.getData()));
            requestId = request.optString("requestId", "");
            String type = request.optString("type", "");
            replyType = type + "Result";
            if (!isMainFrame || !sameOrigin(Uri.parse(bridgeUrl), sourceOrigin)) {
                error = "请求来源不匹配";
            } else if (request.optInt("protocol", 0) != NATIVE_BRIDGE_PROTOCOL || requestId.isEmpty()) {
                error = "通信版本不匹配";
            } else if ("hello".equals(type)) {
                JSONObject reply = baseNativeReply(replyType, requestId, true, null)
                    .put("nativeVersion", BuildConfig.VERSION_NAME)
                    .put("features", new org.json.JSONArray().put("imageViewer"));
                replyProxy.postMessage(reply.toString());
                return;
            } else if ("openImage".equals(type)) {
                JSONObject payload = request.optJSONObject("payload");
                if (payload == null) payload = new JSONObject();
                String path = payload.optString("path", "");
                String previewPath = payload.optString("previewPath", "");
                String token = payload.optString("token", "");
                String title = payload.optString("title", "");
                Uri target = imageUriFromRelativePath(path, false);
                Uri preview = imageUriFromRelativePath(previewPath, true);
                ok = target != null && preview != null && openNativeImage(
                    target.toString(),
                    preview.toString(),
                    token,
                    title
                );
                error = ok ? null : "图片地址或令牌无效";
            }
        } catch (JSONException | RuntimeException reason) {
            error = "原生查看器调用失败";
        }
        try {
            replyProxy.postMessage(baseNativeReply(replyType, requestId, ok, error).toString());
        } catch (JSONException ignored) {
            replyProxy.postMessage("{\"protocol\":1,\"type\":\"error\",\"requestId\":\"\",\"ok\":false}");
        }
    }

    private JSONObject baseNativeReply(String type, String requestId, boolean ok, String error) throws JSONException {
        JSONObject reply = new JSONObject()
            .put("protocol", NATIVE_BRIDGE_PROTOCOL)
            .put("type", type)
            .put("requestId", requestId)
            .put("ok", ok);
        if (error != null) reply.put("error", error);
        return reply;
    }

    private Uri imageUriFromRelativePath(String relativePath, boolean preview) {
        Uri relative = Uri.parse(value(relativePath));
        String path = value(relative.getPath());
        boolean validPath = !relative.isAbsolute()
            && relative.getFragment() == null
            && path.matches("/api/threads/[^/]+/(?:images|attachments)/[^/]+");
        boolean validQuery = preview
            ? "preview".equals(relative.getQueryParameter("variant"))
            : relative.getQuery() == null;
        if (!validPath || !validQuery) return null;
        return Uri.parse(bridgeUrl + relativePath);
    }

    private boolean openNativeImage(String url, String previewUrl, String token, String title) {
        Uri target = Uri.parse(value(url));
        Uri preview = Uri.parse(value(previewUrl));
        Uri bridge = Uri.parse(bridgeUrl);
        String path = value(target.getPath());
        String previewPath = value(preview.getPath());
        boolean valid = sameOrigin(bridge, target) && sameOrigin(bridge, preview)
            && ("https".equalsIgnoreCase(target.getScheme()) || "http".equalsIgnoreCase(target.getScheme()))
            && path.equals(previewPath)
            && path.matches(".*/api/threads/[^/]+/(?:images|attachments)/[^/]+")
            && previewPath.matches(".*/api/threads/[^/]+/(?:images|attachments)/[^/]+")
            && "preview".equals(preview.getQueryParameter("variant"))
            && value(token).length() >= MIN_CONNECTION_PASSWORD_LENGTH;
        if (!valid) {
            Toast.makeText(this, "无法安全地打开这张图片", Toast.LENGTH_SHORT).show();
            return false;
        }

        String safeTitle = value(title).trim();
        if (safeTitle.isEmpty()) safeTitle = "查看图片";
        if (safeTitle.length() > 80) safeTitle = safeTitle.substring(0, 80);
        Intent intent = new Intent(this, ImageViewerActivity.class)
            .putExtra(ImageViewerActivity.EXTRA_URL, target.toString())
            .putExtra(ImageViewerActivity.EXTRA_PREVIEW_URL, preview.toString())
            .putExtra(ImageViewerActivity.EXTRA_TOKEN, token)
            .putExtra(ImageViewerActivity.EXTRA_TITLE, safeTitle);
        try {
            startActivity(intent);
            overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out);
            return true;
        } catch (RuntimeException error) {
            return false;
        }
    }

    private void configureNotificationChannel() {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        manager.createNotificationChannel(new NotificationChannel(
            NOTIFICATION_CHANNEL,
            "Codex 任务",
            NotificationManager.IMPORTANCE_DEFAULT
        ));
    }

    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < 33 ||
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return;
        if (getSharedPreferences(PREFERENCES, MODE_PRIVATE)
            .getBoolean(NOTIFICATION_PERMISSION_ASKED_KEY, false)) return;
        getSharedPreferences(PREFERENCES, MODE_PRIVATE).edit()
            .putBoolean(NOTIFICATION_PERMISSION_ASKED_KEY, true)
            .apply();
        requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION_REQUEST);
    }

    private void showNotification(String title, String body, String threadId) {
        String safeTitle = value(title).isEmpty() ? "Codex Bridge" : title;
        String safeBody = value(body);
        showNotification(safeTitle, safeBody, threadId, (safeTitle + safeBody + value(threadId)).hashCode());
    }

    private void showNotification(String title, String body, String threadId, int notificationId) {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        String safeTitle = value(title).isEmpty() ? "Codex Bridge" : title;
        String safeBody = value(body);
        Uri target = Uri.parse("codexbridge://task?id=" + Uri.encode(value(threadId)));
        Intent launch = new Intent(Intent.ACTION_VIEW, target, this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pending = PendingIntent.getActivity(
            this,
            value(threadId).hashCode(),
            launch,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        Notification notification = new Notification.Builder(this, NOTIFICATION_CHANNEL)
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setContentTitle(safeTitle)
            .setContentText(safeBody)
            .setStyle(new Notification.BigTextStyle().bigText(safeBody))
            .setCategory(Notification.CATEGORY_STATUS)
            .setAutoCancel(true)
            .setContentIntent(pending)
            .build();
        ((NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE))
            .notify(notificationId, notification);
    }

    private void startPairingScan() {
        try {
            startActivityForResult(new Intent(this, ScannerActivity.class), SCANNER_REQUEST);
        } catch (RuntimeException error) {
            Toast.makeText(this, R.string.scanner_start_failed, Toast.LENGTH_LONG).show();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == CONNECTION_REQUEST) {
            settingsVisible = false;
            if (resultCode == RESULT_OK && data != null) {
                String scan = value(data.getStringExtra(ConnectionActivity.RESULT_SCAN));
                if (!scan.isEmpty()) {
                    handleScannedPairing(scan);
                    return;
                }
                String server = value(data.getStringExtra(ConnectionActivity.RESULT_SERVER));
                String token = value(data.getStringExtra(ConnectionActivity.RESULT_TOKEN));
                if (connectToBridge(server, token)) return;
                Toast.makeText(this, R.string.invalid_url, Toast.LENGTH_LONG).show();
                webView.post(() -> showConnectionScreen());
                return;
            }
            if (normalizeUrl(bridgeUrl) == null) finish();
            return;
        }
        if (requestCode == IMAGE_PICKER_REQUEST) {
            ValueCallback<Uri[]> callback = pendingFileCallback;
            pendingFileCallback = null;
            if (callback == null) return;
            if (resultCode != RESULT_OK || data == null) {
                callback.onReceiveValue(null);
                return;
            }
            java.util.ArrayList<Uri> selected = new java.util.ArrayList<>();
            ClipData clip = data.getClipData();
            if (clip != null) {
                for (int index = 0; index < clip.getItemCount() && selected.size() < 4; index++)
                    selected.add(clip.getItemAt(index).getUri());
            } else if (data.getData() != null) selected.add(data.getData());
            callback.onReceiveValue(selected.isEmpty() ? null : selected.toArray(new Uri[0]));
            return;
        }
        if (requestCode == SCANNER_REQUEST) {
            if (resultCode == RESULT_OK && data != null) {
                String result = data.getStringExtra(ScannerActivity.EXTRA_RESULT);
                if (result != null) handleScannedPairing(result);
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    private boolean connectToBridge(String rawServer, String rawToken) {
        String server = normalizeUrl(rawServer);
        String token = value(rawToken).trim();
        if (server == null ||
            (!token.isEmpty() && token.length() < MIN_CONNECTION_PASSWORD_LENGTH)) return false;
        bridgeUrl = server;
        getSharedPreferences(PREFERENCES, MODE_PRIVATE).edit().putString(URL_KEY, bridgeUrl).apply();
        configureNativeMessageBridge();
        if (token.isEmpty()) {
            webView.loadUrl(versionedLaunchUrl(bridgeUrl));
            return true;
        }
        try {
            JSONObject pairing = new JSONObject()
                .put("server", server)
                .put("token", token);
            String payload = Base64.encodeToString(
                pairing.toString().getBytes(StandardCharsets.UTF_8),
                Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING
            );
            webView.loadUrl(pairingLaunchUrl(bridgeUrl, payload));
            return true;
        } catch (JSONException error) {
            return false;
        }
    }

    private void handleScannedPairing(String raw) {
        Uri target = Uri.parse(raw);
        if ("codexbridge".equalsIgnoreCase(target.getScheme()) && "pair".equalsIgnoreCase(target.getHost())) {
            String launchUrl = resolveLaunchUrl(new Intent(Intent.ACTION_VIEW, target));
            if (!launchUrl.equals(bridgeUrl)) {
                configureNativeMessageBridge();
                webView.loadUrl(launchUrl);
            }
            else Toast.makeText(this, R.string.invalid_pairing_qr, Toast.LENGTH_LONG).show();
            return;
        }
        if (("https".equalsIgnoreCase(target.getScheme()) || "http".equalsIgnoreCase(target.getScheme())) &&
            target.getFragment() != null && target.getFragment().startsWith("pair=")) {
            String server = normalizeUrl(target.getScheme() + "://" + target.getEncodedAuthority());
            if (server != null) {
                bridgeUrl = server;
                getSharedPreferences(PREFERENCES, MODE_PRIVATE).edit().putString(URL_KEY, bridgeUrl).apply();
                configureNativeMessageBridge();
                webView.loadUrl(pairingLaunchUrl(server, target.getFragment().substring("pair=".length())));
                return;
            }
        }
        Toast.makeText(this, R.string.invalid_pairing_qr, Toast.LENGTH_LONG).show();
    }

    private String pairingLaunchUrl(String server, String encodedPayload) {
        // A hash-only navigation does not remount the already-open React app. A unique
        // query forces a real document navigation so the pairing bootstrap runs again.
        return server + "/?nativePair=" + System.currentTimeMillis() + "#pair=" + encodedPayload;
    }

    private boolean sameOrigin(Uri left, Uri right) {
        return value(left.getScheme()).equalsIgnoreCase(value(right.getScheme()))
            && value(left.getHost()).equalsIgnoreCase(value(right.getHost()))
            && effectivePort(left) == effectivePort(right);
    }

    private int effectivePort(Uri uri) {
        if (uri.getPort() >= 0) return uri.getPort();
        return "https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80;
    }

    private String value(String value) {
        return value == null ? "" : value;
    }

    private void showConnectionScreen() {
        if (isFinishing() || settingsVisible) return;
        settingsVisible = true;
        boolean requiresConnection = normalizeUrl(bridgeUrl) == null;
        Intent intent = new Intent(this, ConnectionActivity.class)
            .putExtra(ConnectionActivity.EXTRA_CURRENT_SERVER, value(bridgeUrl));
        try {
            startActivityForResult(intent, CONNECTION_REQUEST);
            overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out);
        } catch (RuntimeException error) {
            settingsVisible = false;
            Toast.makeText(this, R.string.connection_screen_failed, Toast.LENGTH_LONG).show();
            if (requiresConnection) finish();
        }
    }

    private String normalizeUrl(String candidate) {
        String trimmed = candidate.trim();
        if (!trimmed.contains("://")) trimmed = "http://" + trimmed;
        try {
            URI parsed = new URI(trimmed);
            String scheme = parsed.getScheme();
            if (parsed.getHost() == null || parsed.getUserInfo() != null ||
                !("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme))) return null;
            String normalized = parsed.toString();
            while (normalized.endsWith("/")) normalized = normalized.substring(0, normalized.length() - 1);
            return normalized;
        } catch (URISyntaxException error) {
            return null;
        }
    }

    @Override
    public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        webView.evaluateJavascript(
            "Boolean(window.CodexBridgeHandleBack && window.CodexBridgeHandleBack())",
            handled -> {
                if ("true".equals(handled)) return;
                if (webView.canGoBack()) webView.goBack();
                else MainActivity.super.onBackPressed();
            }
        );
    }

    @Override
    protected void onDestroy() {
        if (pendingFileCallback != null) pendingFileCallback.onReceiveValue(null);
        pendingFileCallback = null;
        if (webView != null) {
            if (nativeMessageBridgeInstalled && WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
                WebViewCompat.removeWebMessageListener(webView, NATIVE_MESSAGE_OBJECT);
                nativeMessageBridgeInstalled = false;
            }
            webView.removeJavascriptInterface("CodexBridgeAndroid");
            webView.stopLoading();
            webView.setWebViewClient(null);
            webView.destroy();
        }
        super.onDestroy();
    }
}

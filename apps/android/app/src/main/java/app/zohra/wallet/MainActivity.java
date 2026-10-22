package app.zohra.wallet;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Zohra Wallet for Android: a thin, secure shell around the web app on your server, so every interface update reaches
 * users instantly without a new APK. Handles the camera (identity scan), photo picker, Telegram / browser hand-offs,
 * the back button, an offline screen and APK updates published by GitHub Actions.
 */
public class MainActivity extends Activity {
    private static final int FILE_REQ = 7;
    private static final int CAMERA_REQ = 8;

    private WebView web;
    private ValueCallback<Uri[]> fileCb;
    private PermissionRequest pendingPermission;
    private long lastBack;

    private String server() {
        return BuildConfig.SERVER_URL.replaceAll("/+$", "");
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setTextZoom(100);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setUserAgentString(s.getUserAgentString() + " ZohraApp/android ZohraVersion/" + BuildConfig.VERSION_CODE);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setVerticalScrollBarEnabled(false);
        web.addJavascriptInterface(new Bridge(), "ZohraApp");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                Uri base = Uri.parse(server());
                boolean ours = "https".equals(u.getScheme()) && u.getHost() != null && u.getHost().equals(base.getHost())
                        && (u.getPath() == null || !u.getPath().startsWith("/dl/"));
                if (ours) return false;
                openExternal(u.toString());
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) view.loadUrl("file:///android_asset/offline.html");
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCb != null) fileCb.onReceiveValue(null);
                fileCb = cb;
                try {
                    startActivityForResult(params.createIntent(), FILE_REQ);
                } catch (ActivityNotFoundException e) {
                    fileCb = null;
                    return false;
                }
                return true;
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                // only our own pages may use the camera (identity verification)
                Uri origin = request.getOrigin();
                if (origin == null || origin.getHost() == null || !origin.getHost().equals(Uri.parse(server()).getHost())) {
                    request.deny();
                    return;
                }
                runOnUiThread(() -> {
                    if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                        request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
                    } else {
                        pendingPermission = request;
                        requestPermissions(new String[]{Manifest.permission.CAMERA}, CAMERA_REQ);
                    }
                });
            }
        });

        web.setDownloadListener((url, ua, cd, mime, len) -> openExternal(url));

        if (state != null) web.restoreState(state);
        else web.loadUrl(server() + "/");
        checkUpdate();
    }

    private void openExternal(String url) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (Exception e) {
            Toast.makeText(this, url, Toast.LENGTH_SHORT).show();
        }
    }

    /** A newer APK published on the server → offer it once per launch (the interface itself updates without this). */
    private void checkUpdate() {
        new Thread(() -> {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(server() + "/api/releases/latest").openConnection();
                c.setConnectTimeout(8000);
                c.setReadTimeout(8000);
                InputStream in = c.getInputStream();
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[4096];
                for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
                JSONObject android = new JSONObject(out.toString("UTF-8")).optJSONObject("files").optJSONObject("android");
                if (android == null) return;
                String v = android.optString("version", "");
                if (code(v) <= BuildConfig.VERSION_CODE) return;
                String url = server() + android.optString("url");
                new Handler(Looper.getMainLooper()).post(() -> new AlertDialog.Builder(this)
                        .setTitle(R.string.update_title)
                        .setMessage(getString(R.string.update_body, v))
                        .setPositiveButton(R.string.update_now, (d, w) -> openExternal(url))
                        .setNegativeButton(R.string.later, null)
                        .show());
            } catch (Exception ignored) {
                // offline or no release yet
            }
        }).start();
    }

    private static int code(String v) {
        String[] p = v.split("\\.");
        try {
            return Integer.parseInt(p[0]) * 10000 + (p.length > 1 ? Integer.parseInt(p[1]) * 100 : 0) + (p.length > 2 ? Integer.parseInt(p[2]) : 0);
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    @Override
    public void onRequestPermissionsResult(int req, String[] perms, int[] res) {
        if (req == CAMERA_REQ && pendingPermission != null) {
            if (res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED) {
                pendingPermission.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
            } else {
                pendingPermission.deny();
            }
            pendingPermission = null;
        }
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        if (req == FILE_REQ && fileCb != null) {
            fileCb.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res, data));
            fileCb = null;
            return;
        }
        super.onActivityResult(req, res, data);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        String cur = web.getUrl();
        boolean home = cur == null || cur.endsWith("/") || cur.endsWith("#/") || cur.contains("#/?") || cur.startsWith("file:");
        if (web.canGoBack() && !home) {
            web.goBack();
            return;
        }
        long now = System.currentTimeMillis();
        if (now - lastBack < 2000) finish();
        else {
            lastBack = now;
            Toast.makeText(this, R.string.exit_hint, Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onPause() {
        web.onPause();
        CookieManager.getInstance().flush();
        super.onPause();
    }

    /** JavaScript bridge: window.ZohraApp */
    private class Bridge {
        @JavascriptInterface
        public int getVersionCode() { return BuildConfig.VERSION_CODE; }

        @JavascriptInterface
        public String getVersionName() { return BuildConfig.VERSION_NAME; }

        @JavascriptInterface
        public void openExternal(String url) {
            if (url != null && url.startsWith("https://")) runOnUiThread(() -> MainActivity.this.openExternal(url));
        }

        @JavascriptInterface
        public void share(String text) {
            runOnUiThread(() -> {
                Intent i = new Intent(Intent.ACTION_SEND);
                i.setType("text/plain");
                i.putExtra(Intent.EXTRA_TEXT, text);
                startActivity(Intent.createChooser(i, getString(R.string.app_name)));
            });
        }

        @JavascriptInterface
        public void retry() { runOnUiThread(() -> web.loadUrl(server() + "/")); }
    }
}

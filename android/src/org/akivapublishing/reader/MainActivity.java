package org.akivapublishing.reader;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Message;
import android.text.Editable;
import android.text.TextWatcher;
import android.text.TextUtils;
import android.util.Base64;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ServiceWorkerController;
import android.webkit.SslErrorHandler;
import android.webkit.URLUtil;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.PopupMenu;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import org.json.JSONObject;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.SecureRandom;

/** A resizable, CPU-independent Android reader for the live Akiva library. */
public final class MainActivity extends Activity {
    static final String HOME = "https://akiva-publishing-kisvei-rav-tzadok.netlify.app/library/";
    private static final String HOST = "akiva-publishing-kisvei-rav-tzadok.netlify.app";
    private static final int SAVE_FILE = 10;
    WebView reader;
    private ProgressBar progress;
    private LinearLayout errorView;
    private boolean mainError;
    private String retryUrl = HOME;
    private Download pendingDownload;
    private Download blobDownload;
    private final Object downloadLock = new Object();

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(23, 55, 45));
        setContentView(root);
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((v, insets) -> {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars()
                    | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return insets;
            });
            root.requestApplyInsets();
        }
        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        root.addView(toolbar, new LinearLayout.LayoutParams(-1, dp(48)));
        Button back = toolbarButton("‹", "Go back");
        back.setOnClickListener(v -> goBack());
        toolbar.addView(back, new LinearLayout.LayoutParams(dp(48), -1));
        TextView title = new TextView(this);
        title.setText(R.string.app_name); title.setTextColor(Color.WHITE); title.setTextSize(16);
        title.setSingleLine(true); title.setEllipsize(TextUtils.TruncateAt.END);
        title.setGravity(Gravity.CENTER_VERTICAL);
        title.setContentDescription(getString(R.string.app_name) + ". Tap to open the library.");
        title.setOnClickListener(v -> reader.loadUrl(HOME + "#/"));
        toolbar.addView(title, new LinearLayout.LayoutParams(0, -1, 1));
        Button more = toolbarButton("⋮", "Reader menu");
        more.setOnClickListener(v -> showMenu(v));
        toolbar.addView(more, new LinearLayout.LayoutParams(dp(48), -1));
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100); progress.setVisibility(View.GONE);
        root.addView(progress, new LinearLayout.LayoutParams(-1, dp(3)));
        FrameLayout content = new FrameLayout(this);
        content.setBackgroundColor(Color.rgb(251, 248, 241));
        root.addView(content, new LinearLayout.LayoutParams(-1, 0, 1));
        reader = new WebView(this);
        reader.setBackgroundColor(Color.rgb(251, 248, 241));
        content.addView(reader, new FrameLayout.LayoutParams(-1, -1));
        createErrorView(content);
        configureReader();
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::goBack);
        }
        String initial = intentUrl(getIntent());
        if (initial == null && state != null && reader.restoreState(state) != null) return;
        if (initial == null) initial = getPreferences(MODE_PRIVATE).getString("lastUrl", HOME);
        reader.loadUrl(isLibraryUrl(initial) ? initial : HOME);
    }

    private void configureReader() {
        WebSettings s = reader.getSettings();
        s.setJavaScriptEnabled(true); s.setDomStorageEnabled(true);
        s.setUseWideViewPort(true); s.setLoadWithOverviewMode(true);
        s.setBuiltInZoomControls(true); s.setDisplayZoomControls(false);
        s.setAllowFileAccess(false); s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSupportMultipleWindows(true); s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setUserAgentString(s.getUserAgentString() + " AkivaPublishingAndroid/1.0.2");
        if (Build.VERSION.SDK_INT >= 26) s.setSafeBrowsingEnabled(true);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(reader, false);
        ServiceWorkerController.getInstance().getServiceWorkerWebSettings().setAllowFileAccess(false);
        ServiceWorkerController.getInstance().getServiceWorkerWebSettings().setAllowContentAccess(false);
        reader.addJavascriptInterface(new DownloadBridge(), "AkivaFileExport");
        reader.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                if (!r.isForMainFrame()) return false;
                if (isLibraryUrl(r.getUrl().toString())) return false;
                openExternal(r.getUrl()); return true;
            }
            @Override public void onPageStarted(WebView v, String url, android.graphics.Bitmap icon) {
                mainError = false; errorView.setVisibility(View.GONE);
            }
            @Override public void onPageFinished(WebView v, String url) {
                if (mainError || !isLibraryUrl(url)) return;
                remember(url);
                // Let the website recognize its installed Android context.
                v.evaluateJavascript("Object.defineProperty(navigator,'standalone',{value:true,configurable:true});", null);
            }
            @Override public void doUpdateVisitedHistory(WebView v, String url, boolean reload) {
                remember(url);
            }
            @Override public void onReceivedError(WebView v, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showError(request.getUrl().toString());
            }
            @Override public void onReceivedSslError(WebView v, SslErrorHandler handler, SslError error) {
                handler.cancel(); // Never bypass certificate validation.
            }
        });
        reader.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView v, int value) {
                progress.setProgress(value); progress.setVisibility(value < 100 ? View.VISIBLE : View.GONE);
            }
            @Override public boolean onCreateWindow(WebView v, boolean dialog, boolean userGesture, Message result) {
                if (!userGesture) return false;
                WebView popup = new WebView(MainActivity.this);
                popup.setWebViewClient(new WebViewClient() {
                    @Override public boolean shouldOverrideUrlLoading(WebView ignored, WebResourceRequest r) {
                        String url = r.getUrl().toString();
                        if (isLibraryUrl(url)) reader.loadUrl(url); else openExternal(r.getUrl());
                        popup.post(popup::destroy); return true;
                    }
                });
                ((WebView.WebViewTransport) result.obj).setWebView(popup);
                result.sendToTarget(); return true;
            }
        });
        reader.setDownloadListener((url, userAgent, disposition, mime, length) -> {
            boolean blob = url.startsWith("blob:" + HOME.substring(0, HOME.indexOf("/library/")) + "/");
            if (!blob && !isLibraryUrl(url)) { openExternal(Uri.parse(url)); return; }
            if (pendingDownload != null || blobDownload != null) { toast("A file is already being saved."); return; }
            String type = mime == null || mime.isEmpty() ? "application/octet-stream" : mime;
            String filename = URLUtil.guessFileName(url, disposition, type);
            if (blob) filename = type.contains("svg") ? "akiva-library-qr.svg" : "akiva-saved-texts.zip";
            pendingDownload = new Download(url, type, filename);
            Intent save = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                .setType(type).putExtra(Intent.EXTRA_TITLE, filename);
            try { startActivityForResult(save, SAVE_FILE); }
            catch (ActivityNotFoundException e) { pendingDownload = null; toast("No file picker is available."); }
        });
    }

    private Button toolbarButton(String text, String description) {
        Button b = new Button(this); b.setText(text); b.setTextSize(26);
        b.setTextColor(Color.WHITE); b.setBackgroundColor(Color.TRANSPARENT);
        b.setPadding(0, 0, 0, 0); b.setContentDescription(description);
        return b;
    }

    private void createErrorView(FrameLayout content) {
        errorView = new LinearLayout(this); errorView.setOrientation(LinearLayout.VERTICAL);
        errorView.setGravity(Gravity.CENTER); errorView.setPadding(dp(28), dp(28), dp(28), dp(28));
        errorView.setBackgroundColor(Color.rgb(251, 248, 241));
        TextView message = new TextView(this); message.setGravity(Gravity.CENTER); message.setTextSize(18);
        message.setText("Open the library while online the first time.\n\nUse Save offline in the library to keep texts on this device.");
        errorView.addView(message);
        Button retry = new Button(this); retry.setText("Try again");
        retry.setOnClickListener(v -> reader.loadUrl(isLibraryUrl(retryUrl) ? retryUrl : HOME));
        errorView.addView(retry); errorView.setVisibility(View.GONE);
        content.addView(errorView, new FrameLayout.LayoutParams(-1, -1));
    }

    private void showError(String url) {
        mainError = true; retryUrl = url; progress.setVisibility(View.GONE);
        errorView.setVisibility(View.VISIBLE);
    }

    static boolean isLibraryUrl(String url) {
        if (url == null) return false;
        Uri uri = Uri.parse(url);
        return "https".equals(uri.getScheme()) && HOST.equals(uri.getHost())
            && (uri.getPort() == -1 || uri.getPort() == 443) && uri.getUserInfo() == null
            && ("/library".equals(uri.getPath()) || (uri.getPath() != null && uri.getPath().startsWith("/library/")));
    }

    private void remember(String url) {
        if (isLibraryUrl(url) && !Uri.parse(url).getPath().startsWith("/library/privacy"))
            getPreferences(MODE_PRIVATE).edit().putString("lastUrl", url).apply();
    }

    private String intentUrl(Intent intent) {
        if (Intent.ACTION_VIEW.equals(intent.getAction()) && intent.getData() != null
            && isLibraryUrl(intent.getData().toString())) return intent.getData().toString();
        return null;
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent); setIntent(intent);
        String url = intentUrl(intent); if (url != null) reader.loadUrl(url);
    }
    @Override protected void onSaveInstanceState(Bundle state) { reader.saveState(state); super.onSaveInstanceState(state); }
    @Override protected void onResume() { super.onResume(); if (reader != null) reader.onResume(); }
    @Override protected void onPause() { if (reader != null) reader.onPause(); super.onPause(); }
    @Override protected void onDestroy() {
        synchronized (downloadLock) { closeBlob(false); }
        if (reader != null) { reader.removeJavascriptInterface("AkivaFileExport"); reader.destroy(); }
        super.onDestroy();
    }
    @Override public void onBackPressed() { goBack(); }

    private void goBack() {
        // The web reader keeps its functions inside a closure. Use its bound
        // close control so the native Back action follows the same path as a tap.
        reader.evaluateJavascript("(()=>{const panel=document.getElementById('panel');"
            + "const close=document.getElementById('pClose');"
            + "if(panel&&!panel.hidden&&close){close.click();return true;}return false;})()", value -> {
            if (!"true".equals(value)) { if (reader.canGoBack()) reader.goBack(); else finish(); }
        });
    }

    @Override public boolean onKeyDown(int key, KeyEvent event) {
        if (event.isCtrlPressed() && key == KeyEvent.KEYCODE_F) { findInText(); return true; }
        if (event.isCtrlPressed() && key == KeyEvent.KEYCODE_R) { reader.reload(); return true; }
        if (event.isAltPressed() && key == KeyEvent.KEYCODE_DPAD_LEFT) { goBack(); return true; }
        if (key == KeyEvent.KEYCODE_ESCAPE) { goBack(); return true; }
        return super.onKeyDown(key, event);
    }

    private void showMenu(View anchor) {
        PopupMenu menu = new PopupMenu(this, anchor);
        for (String label : new String[]{"Library", "Find in text", "Refresh", "Share reading link", "Open in browser", "Privacy policy"})
            menu.getMenu().add(label);
        menu.setOnMenuItemClickListener(item -> {
            switch (item.getTitle().toString()) {
                case "Library": reader.loadUrl(HOME + "#/"); break;
                case "Find in text": findInText(); break;
                case "Refresh": reader.reload(); break;
                case "Share reading link":
                    Intent share = new Intent(Intent.ACTION_SEND).setType("text/plain")
                        .putExtra(Intent.EXTRA_TEXT, currentUrl()).putExtra(Intent.EXTRA_SUBJECT, getString(R.string.app_name));
                    startActivity(Intent.createChooser(share, "Share reading link")); break;
                case "Open in browser": openExternal(Uri.parse(currentUrl())); break;
                case "Privacy policy": reader.loadUrl(HOME + "privacy/"); break;
            }
            return true;
        });
        menu.show();
    }

    private String currentUrl() { return isLibraryUrl(reader.getUrl()) ? reader.getUrl() : HOME; }

    private void findInText() {
        EditText text = new EditText(this); text.setSingleLine(true); text.setHint("Hebrew or English");
        text.addTextChangedListener(new TextWatcher() {
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            public void onTextChanged(CharSequence s, int start, int before, int count) { reader.findAllAsync(s.toString()); }
            public void afterTextChanged(Editable e) {}
        });
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle("Find in text").setView(text)
            .setPositiveButton("Next", null).setNegativeButton("Close", (d, w) -> reader.clearMatches()).create();
        dialog.setOnShowListener(d -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> reader.findNext(true)));
        dialog.setOnDismissListener(d -> reader.clearMatches()); dialog.show();
    }

    private void openExternal(Uri uri) {
        String scheme = uri.getScheme();
        if (!"https".equals(scheme) && !"http".equals(scheme) && !"mailto".equals(scheme) && !"tel".equals(scheme)) {
            toast("This link cannot be opened."); return;
        }
        Intent view = new Intent(Intent.ACTION_VIEW, uri);
        // Exclude this package so our own deep links do not loop back into the reader.
        Intent chooser = Intent.createChooser(view, "Open link");
        chooser.putExtra(Intent.EXTRA_EXCLUDE_COMPONENTS,
            new android.content.ComponentName[]{new android.content.ComponentName(this, MainActivity.class)});
        try { startActivity(chooser); } catch (ActivityNotFoundException e) { toast("Install a browser to open this link."); }
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != SAVE_FILE || pendingDownload == null) return;
        Download download = pendingDownload; pendingDownload = null;
        if (result != RESULT_OK || data == null || data.getData() == null) return;
        download.destination = data.getData();
        if (download.url.startsWith("blob:")) saveBlob(download); else saveHttp(download);
    }

    private void saveHttp(Download download) {
        toast("Saving " + download.filename + "…");
        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                String url = download.url;
                for (int redirects = 0; redirects < 5; redirects++) {
                    if (!isLibraryUrl(url)) throw new Exception("Unexpected download destination");
                    connection = (HttpURLConnection) new URL(url).openConnection();
                    connection.setConnectTimeout(20000); connection.setReadTimeout(60000);
                    connection.setInstanceFollowRedirects(false);
                    int status = connection.getResponseCode();
                    if (status >= 300 && status < 400) {
                        String location = connection.getHeaderField("Location");
                        if (location == null) throw new Exception("Missing redirect");
                        url = new URL(new URL(url), location).toString(); connection.disconnect(); connection = null; continue;
                    }
                    if (status != 200) throw new Exception("Download unavailable");
                    try (InputStream input = connection.getInputStream();
                         OutputStream output = getContentResolver().openOutputStream(download.destination, "wt")) {
                        if (output == null) throw new Exception("No output file");
                        byte[] buffer = new byte[65536]; int count;
                        while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                    }
                    runOnUiThread(() -> toast("Saved " + download.filename)); return;
                }
                throw new Exception("Too many redirects");
            } catch (Exception e) {
                removePartial(download); runOnUiThread(() -> toast("Could not save the file. Check your connection and try again."));
            } finally { if (connection != null) connection.disconnect(); }
        }, "Akiva-download").start();
    }

    private void saveBlob(Download download) {
        try {
            download.output = getContentResolver().openOutputStream(download.destination, "wt");
            if (download.output == null) throw new Exception("No output file");
            byte[] token = new byte[32]; new SecureRandom().nextBytes(token);
            download.token = Base64.encodeToString(token, Base64.NO_WRAP | Base64.URL_SAFE);
            synchronized (downloadLock) { blobDownload = download; }
            String script = "(async()=>{const t=" + JSONObject.quote(download.token) + ";try{"
                + "const r=await fetch(" + JSONObject.quote(download.url) + ");const b=await r.blob();let i=0;"
                + "for(let p=0;p<b.size;p+=393216){const part=b.slice(p,p+393216);"
                + "const encoded=await new Promise((ok,no)=>{const f=new FileReader();f.onload=()=>ok(f.result.split(',')[1]);f.onerror=no;f.readAsDataURL(part)});"
                + "if(!AkivaFileExport.write(t,i++,encoded))throw Error('Save failed');}AkivaFileExport.finish(t);"
                + "}catch(e){AkivaFileExport.fail(t)}})()";
            reader.evaluateJavascript(script, null);
        } catch (Exception e) { removePartial(download); toast("Could not save the exported file."); }
    }

    public final class DownloadBridge {
        @JavascriptInterface public boolean write(String token, int sequence, String encoded) {
            synchronized (downloadLock) {
                Download d = blobDownload;
                if (d == null || !d.token.equals(token) || d.sequence != sequence || encoded == null || encoded.length() > 524288) return false;
                try { d.output.write(Base64.decode(encoded, Base64.DEFAULT)); d.sequence++; return true; }
                catch (Exception e) { closeBlob(false); return false; }
            }
        }
        @JavascriptInterface public void finish(String token) {
            synchronized (downloadLock) { if (blobDownload != null && blobDownload.token.equals(token)) closeBlob(true); }
        }
        @JavascriptInterface public void fail(String token) {
            synchronized (downloadLock) { if (blobDownload != null && blobDownload.token.equals(token)) closeBlob(false); }
        }
    }

    private void closeBlob(boolean success) {
        Download d = blobDownload; blobDownload = null; if (d == null) return;
        try { d.output.close(); } catch (Exception e) { success = false; }
        if (!success) removePartial(d);
        final boolean saved = success;
        runOnUiThread(() -> toast(saved ? "Saved " + d.filename : "Could not save the exported file. Please try again."));
    }

    private void removePartial(Download d) {
        try { android.provider.DocumentsContract.deleteDocument(getContentResolver(), d.destination); } catch (Exception ignored) {}
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private void toast(String message) { Toast.makeText(this, message, Toast.LENGTH_LONG).show(); }
    private static final class Download {
        final String url, mime, filename;
        Uri destination; OutputStream output; String token; int sequence;
        Download(String url, String mime, String filename) { this.url = url; this.mime = mime; this.filename = filename; }
    }
}

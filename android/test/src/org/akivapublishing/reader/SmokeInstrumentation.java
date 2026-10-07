package org.akivapublishing.reader;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import java.io.File;
import java.io.FileOutputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/** Exercises real WebView layout, connections, resize state, and offline caches. */
public final class SmokeInstrumentation extends Instrumentation {
    private MainActivity activity;
    @Override public void onCreate(Bundle args) { super.onCreate(args); start(); }
    @Override public void onStart() {
        Bundle result = new Bundle();
        try {
            shell("wm density 160"); shell("wm size 360x800");
            Intent intent = new Intent(getTargetContext(), MainActivity.class)
                .setAction(Intent.ACTION_VIEW).setData(Uri.parse(MainActivity.HOME + "#/read/Tzidkat_HaTzadik_2"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity = (MainActivity) startActivitySync(intent);
            waitFor("document.querySelectorAll('.ph-he').length>0", 90000);
            assertJs("location.hash==='#/read/Tzidkat_HaTzadik_2'", "Tzidkas reading route");
            assertJs("document.querySelectorAll('a.cite').length>0", "Sefaria citations");
            waitFor("!!navigator.serviceWorker.controller", 60000);
            String[][] sizes = {{"phone", "360x800"}, {"tablet", "800x1280"},
                {"laptop", "1280x800"}, {"phone-landscape", "800x360"}};
            for (String[] size : sizes) {
                shell("wm size " + size[1]);
                int expected = Integer.parseInt(size[1].split("x")[0]);
                waitFor("innerWidth>=" + (expected - 80) + "&&innerWidth<=" + expected, 15000);
                assertJs("location.hash==='#/read/Tzidkat_HaTzadik_2'", "Reading state survives resize");
                assertJs("document.documentElement.scrollWidth<=innerWidth+2", size[0] + " has no horizontal overflow");
                js("(document.querySelector('.seg').click(),true)");
                waitFor("document.body.classList.contains('panel-open')", 15000);
                waitFor("document.querySelector('#pContent .source-controls')!==null", 45000);
                assertJs("document.querySelectorAll('#pContent .cat').length>0", "Source connections are available");
                assertJs(expected > 980 ? "getComputedStyle(document.querySelector('#panel')).position==='sticky'"
                    : "getComputedStyle(document.querySelector('#panel')).position==='fixed'", "Adaptive connections layout");
                screenshot(size[0]);
                js("(closePanel(),true)");
            }
            // Reload the saved chapter with all WebView and worker network loads blocked.
            runOnMainSync(() -> {
                activity.reader.getSettings().setBlockNetworkLoads(true);
                android.webkit.ServiceWorkerController.getInstance().getServiceWorkerWebSettings().setBlockNetworkLoads(true);
                activity.reader.reload();
            });
            Thread.sleep(1000);
            waitFor("document.querySelectorAll('.ph-he').length>0", 45000);
            assertJs("location.hash==='#/read/Tzidkat_HaTzadik_2'", "Offline reading route");
            screenshot("offline");
            result.putString("akiva.status", "passed");
            result.putString("akiva.checks", "phone,tablet,laptop,landscape,resize-state,citations,connections,offline-reload");
            finish(Activity.RESULT_OK, result);
        } catch (Throwable error) {
            result.putString("akiva.status", "failed");
            result.putString("akiva.error", error.toString());
            android.util.Log.e("AkivaSmoke", "Smoke test failed", error);
            try { screenshot("failure"); } catch (Throwable ignored) {}
            finish(Activity.RESULT_CANCELED, result);
        }
    }

    private void shell(String command) throws Exception {
        try (ParcelFileDescriptor output = getUiAutomation().executeShellCommand(command);
             java.io.InputStream input = new ParcelFileDescriptor.AutoCloseInputStream(output)) {
            byte[] buffer = new byte[1024]; while (input.read(buffer) != -1) {}
        }
        Thread.sleep(1200); waitForIdleSync();
    }
    private String js(String expression) throws Exception {
        CountDownLatch ready = new CountDownLatch(1); String[] value = new String[1];
        runOnMainSync(() -> activity.reader.evaluateJavascript("(()=>{" + "return (" + expression + ")})()",
            r -> { value[0] = r; ready.countDown(); }));
        if (!ready.await(15, TimeUnit.SECONDS)) throw new AssertionError("JavaScript timed out");
        return value[0];
    }
    private void assertJs(String expression, String message) throws Exception {
        if (!"true".equals(js(expression))) throw new AssertionError(message + ": " + expression);
    }
    private void waitFor(String expression, long timeout) throws Exception {
        long deadline = System.currentTimeMillis() + timeout;
        while (System.currentTimeMillis() < deadline) {
            if ("true".equals(js(expression))) return;
            Thread.sleep(500);
        }
        throw new AssertionError("Condition timed out: " + expression);
    }
    private void screenshot(String name) throws Exception {
        File directory = new File(getTargetContext().getExternalFilesDir(null), "smoke-screenshots");
        directory.mkdirs();
        Bitmap image = getUiAutomation().takeScreenshot();
        if (image == null) throw new AssertionError("No screenshot");
        try (FileOutputStream out = new FileOutputStream(new File(directory, name + ".png"))) {
            image.compress(Bitmap.CompressFormat.PNG, 100, out);
        }
        image.recycle();
    }
}

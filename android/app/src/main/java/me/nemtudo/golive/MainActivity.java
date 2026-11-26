package me.nemtudo.golive;

import android.content.Intent;
import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.Log;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import androidx.annotation.Nullable;
import androidx.lifecycle.Lifecycle;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {

    // Must run before super.onCreate() — that is where BridgeActivity
    // finalizes the plugin list it was given (see its own load()), so a
    // plugin registered afterwards would simply never be found by JS's
    // registerPlugin("ScreenCapture") call in lib/androidScreenCapture.ts.
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ScreenCapturePlugin.class);
        registerPlugin(PictureInPicturePlugin.class);
        registerPlugin(GoLiveNotificationsPlugin.class);
        registerPlugin(AppChromePlugin.class);
        registerPlugin(CallServicePlugin.class);
        registerPlugin(DualCameraPlugin.class);
        registerPlugin(InAppReviewPlugin.class);
        bridgeBuilder.addWebViewListener(new RendererCrashRecovery());
        showOverLockScreenForCall(getIntent());
        super.onCreate(savedInstanceState);
    }

    private static final String TAG = "GoLiveMain";

    /** Two renderer deaths closer together than this and the app gives up
     *  on reloading: a page that kills its renderer straight away would
     *  otherwise spin in a reload loop the person cannot get out of. */
    private static final long RENDERER_RETRY_WINDOW_MS = 15_000L;
    private static long lastRendererGoneAt = 0L;

    /** "crashed:fg", "killed:bg"… set when the renderer died, read once by the next page. */
    @Nullable
    private static volatile String pendingRecovery = null;

    @Nullable
    static String takeRendererRecovery() {
        String value = pendingRecovery;
        pendingRecovery = null;
        return value;
    }

    /**
     * The single biggest source of this app's crashes. The page runs in a
     * separate renderer process, and Android kills that process on its own —
     * for memory, most often with the app in the background during a call,
     * or it crashes outright (a GPU driver, a video decoder). WebView then
     * asks the app what to do, and Capacitor's answer when no listener
     * claims it is "nothing", which makes Android kill the *whole app* and
     * count it as a crash in Play's vitals.
     *
     * Claiming it and rebuilding the activity loads the site again in a
     * fresh renderer instead: the person sees the app reopen rather than
     * close. The dead WebView is taken off the screen first (it can no
     * longer draw); the bridge destroys it when the old activity's window
     * goes away.
     */
    private final class RendererCrashRecovery extends WebViewListener {
        @Override
        public boolean onRenderProcessGone(WebView webView, RenderProcessGoneDetail detail) {
            boolean crashed = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && detail != null && detail.didCrash();
            Log.w(TAG, "WebView renderer gone (" + (crashed ? "crashed" : "killed by the system") + "); reloading");

            if (webView != null && webView.getParent() instanceof ViewGroup) {
                ((ViewGroup) webView.getParent()).removeView(webView);
            }

            // For the page that loads next (AppChromePlugin.takeRendererRecovery,
            // experiment android-jank): how often this happens, and whether it
            // was with the app on screen or away during a call.
            boolean onScreen = getLifecycle().getCurrentState().isAtLeast(Lifecycle.State.STARTED);
            pendingRecovery = (crashed ? "crashed" : "killed") + (onScreen ? ":fg" : ":bg");

            long now = SystemClock.elapsedRealtime();
            boolean looping = lastRendererGoneAt != 0L && now - lastRendererGoneAt < RENDERER_RETRY_WINDOW_MS;
            lastRendererGoneAt = now;
            if (isFinishing() || isDestroyed()) return true;
            if (looping) {
                finish();
            } else {
                recreate();
            }
            return true;
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        showOverLockScreenForCall(intent);
        super.onNewIntent(intent);
    }

    /**
     * The app is in front, so what its notifications were announcing is on
     * screen now — the conversations go, and a ringing call hands over to the
     * app's own ring screen (see GoLiveNotifications.clearOnOpen).
     */
    @Override
    public void onResume() {
        super.onResume();
        GoLiveNotifications.clearOnOpen(this);
    }

    /**
     * A ring opens the app over the lock screen, the way a phone call does —
     * otherwise the full-screen notification would launch the app *behind*
     * the lock screen and the ring would be a sound with nothing to answer.
     * Only for that launch: {@link #onStop} puts the lock screen back in
     * charge, so the app is never left reachable past it.
     */
    private void showOverLockScreenForCall(Intent intent) {
        if (intent == null || !intent.hasExtra(GoLiveNotifications.EXTRA_CALL_ACTION)) return;
        setLockScreenFlags(true);
    }

    @Override
    public void onStop() {
        super.onStop();
        setLockScreenFlags(false);
    }

    private void setLockScreenFlags(boolean on) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(on);
            setTurnScreenOn(on);
        } else if (on) {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        } else {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
    }

    /**
     * Android tells the *activity*, not the plugin, when the window enters or
     * leaves picture-in-picture — including when the user closes the floating
     * window or taps it to come back, which nothing on the JS side would
     * otherwise hear about. Forwarded so the web app can drop its stripped
     * single-tile layout again (see the data-pip rules in app/globals.css).
     */
    @Override
    public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode, Configuration newConfig) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
        PictureInPicturePlugin.notifyModeChanged(isInPictureInPictureMode);
    }
}

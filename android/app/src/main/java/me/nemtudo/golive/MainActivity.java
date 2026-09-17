package me.nemtudo.golive;

import android.content.Intent;
import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

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
        showOverLockScreenForCall(getIntent());
        super.onCreate(savedInstanceState);
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

package me.nemtudo.golive;

import android.app.Activity;
import android.app.PictureInPictureParams;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Rational;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.lang.ref.WeakReference;

/**
 * Picture-in-picture for the Android shell — see lib/androidPictureInPicture.ts
 * for the JS half.
 *
 * This exists because the web API does not. {@code
 * HTMLVideoElement.requestPictureInPicture()} is desktop-only; in a WebView
 * (and in Chrome for Android) {@code document.pictureInPictureEnabled} is
 * false, which is why the site's own PiP button correctly hides itself there.
 * Android's picture-in-picture is a property of the <em>activity</em>, not of
 * a video element: the whole window shrinks into the floating box.
 *
 * That difference is the whole reason the JS side does what it does. Since
 * Android will float whatever this activity happens to be rendering, the web
 * app switches to a stripped, single-tile layout before asking to enter — see
 * the {@code data-pip} rules in app/globals.css. Without that, "picture in
 * picture" would put a header, a chat column and a participant list into a
 * box the size of a playing card.
 *
 * Nothing here needs a permission. PiP is a mode the system grants on
 * request; the user can refuse it globally in Android's settings, in which
 * case {@link #enter} simply returns entered=false and the site leaves its
 * layout alone.
 */
@CapacitorPlugin(name = "PictureInPicture")
public class PictureInPicturePlugin extends Plugin {

    /**
     * The live instance, so {@link MainActivity}'s lifecycle callback can
     * reach it.
     *
     * A static weak reference rather than a lookup through the bridge because
     * the callback arrives on the activity, not on the plugin, and there is
     * exactly one of each for the life of the process. Weak so a destroyed
     * activity's plugin is still collectable — the field would otherwise
     * outlive it and hold the whole WebView with it.
     */
    private static WeakReference<PictureInPicturePlugin> instance = new WeakReference<>(null);

    @Override
    public void load() {
        instance = new WeakReference<>(this);
    }

    /** Called by {@link MainActivity#onPictureInPictureModeChanged}. */
    static void notifyModeChanged(boolean inPictureInPicture) {
        PictureInPicturePlugin plugin = instance.get();
        if (plugin == null) return;
        JSObject data = new JSObject();
        data.put("active", inPictureInPicture);
        plugin.notifyListeners("modeChange", data);
    }

    private boolean deviceSupportsPip() {
        Activity activity = getActivity();
        if (activity == null) return false;
        // API 26 rather than 24, which is when enterPictureInPictureMode()
        // first appeared: the no-argument form on 24/25 gives no control over
        // the window's aspect ratio, so a 16:9 share would be letterboxed into
        // whatever shape the system picked. Below 26 the button simply does
        // not appear, which is honest — the site already has a "not supported
        // here" path for every desktop browser without PiP.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false;
        // Present on phones and absent on plenty of TVs and cheap tablets,
        // and the manifest flag does not change that — asking the system is
        // the only answer that is true on the device in hand.
        return activity.getPackageManager().hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE);
    }

    @PluginMethod
    public void isSupported(PluginCall call) {
        JSObject result = new JSObject();
        result.put("supported", deviceSupportsPip());
        call.resolve(result);
    }

    @PluginMethod
    public void enter(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null || !deviceSupportsPip()) {
            JSObject result = new JSObject();
            result.put("entered", false);
            call.resolve(result);
            return;
        }

        // The shape of the thing being watched, so the floating window is not
        // a different aspect ratio from the video inside it. Android clamps
        // this to roughly 1:2.39..2.39:1 and *throws* on anything outside
        // that, so it is clamped here rather than trusted — a caller passing
        // a freak ratio must not crash the app out of a button press.
        double ratio = call.getDouble("aspectRatio", 16.0 / 9.0);
        if (Double.isNaN(ratio) || Double.isInfinite(ratio) || ratio <= 0) ratio = 16.0 / 9.0;
        ratio = Math.max(0.42, Math.min(2.39, ratio));

        final double finalRatio = ratio;
        // On the UI thread because entering PiP is a window operation, and
        // this arrives on Capacitor's bridge thread.
        activity.runOnUiThread(() -> {
            boolean entered = false;
            try {
                PictureInPictureParams params = new PictureInPictureParams.Builder()
                    .setAspectRatio(new Rational((int) Math.round(finalRatio * 1000), 1000))
                    .build();
                entered = activity.enterPictureInPictureMode(params);
            } catch (IllegalStateException | IllegalArgumentException e) {
                // The system refused: PiP disabled for this app in settings,
                // the activity is not in a state that may enter it, or the
                // ratio was rejected despite the clamp above. All of them mean
                // the same thing to the caller — no floating window — and none
                // of them is worth taking the app down for.
                entered = false;
            }
            JSObject result = new JSObject();
            result.put("entered", entered);
            call.resolve(result);
        });
    }
}

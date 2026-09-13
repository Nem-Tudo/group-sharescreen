package me.nemtudo.golive;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.Build;
import android.view.HapticFeedbackConstants;
import android.view.View;
import android.view.Window;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The phone-shaped bits of the shell — see lib/nativeApp.ts for the site's half.
 *
 * <ul>
 *   <li>{@link #setColors}: the status and navigation bars in the page's own
 *       colours. From Android 15 the app draws edge to edge and Capacitor pads
 *       the WebView away from the bars, so what shows behind them is the
 *       WebView's parent — painted here. Before 15 the bars have colours of
 *       their own, set here too.
 *   <li>{@link #haptic}: a tap you can feel, through the view's own haptic
 *       feedback — no vibration permission, and it follows the phone's
 *       "vibrar ao tocar" setting like every other app's buttons do.
 *   <li>{@link #share}: the system share sheet. The WebView has no {@code
 *       navigator.share}, which Chrome does; this is what stands in for it.
 * </ul>
 */
@CapacitorPlugin(name = "AppChrome")
public class AppChromePlugin extends Plugin {

    @PluginMethod
    public void setColors(PluginCall call) {
        String background = call.getString("background", "#ffffff");
        boolean dark = Boolean.TRUE.equals(call.getBoolean("dark", false));
        int color;
        try {
            color = Color.parseColor(background);
        } catch (IllegalArgumentException e) {
            call.reject("Invalid colour");
            return;
        }
        Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            Window window = activity.getWindow();
            window.getDecorView().setBackgroundColor(color);
            View webView = getBridge().getWebView();
            if (webView != null && webView.getParent() instanceof View) {
                ((View) webView.getParent()).setBackgroundColor(color);
            }
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) {
                window.setStatusBarColor(color);
                window.setNavigationBarColor(color);
            }
            WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
            // Dark icons on a light page, light icons on a dark one.
            controller.setAppearanceLightStatusBars(!dark);
            controller.setAppearanceLightNavigationBars(!dark);
            call.resolve();
        });
    }

    @PluginMethod
    public void haptic(PluginCall call) {
        String kind = call.getString("kind", "tap");
        View view = getBridge().getWebView();
        if (view == null) {
            call.resolve();
            return;
        }
        int feedback;
        switch (kind) {
            case "confirm":
                feedback = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                    ? HapticFeedbackConstants.CONFIRM
                    : HapticFeedbackConstants.VIRTUAL_KEY;
                break;
            case "reject":
                feedback = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                    ? HapticFeedbackConstants.REJECT
                    : HapticFeedbackConstants.LONG_PRESS;
                break;
            default:
                feedback = HapticFeedbackConstants.KEYBOARD_TAP;
                break;
        }
        view.post(() -> view.performHapticFeedback(feedback));
        call.resolve();
    }

    @PluginMethod
    public void share(PluginCall call) {
        String title = call.getString("title");
        String text = call.getString("text");
        String url = call.getString("url");
        StringBuilder body = new StringBuilder();
        if (text != null && !text.isEmpty()) body.append(text);
        if (url != null && !url.isEmpty()) {
            if (body.length() > 0) body.append('\n');
            body.append(url);
        }
        if (body.length() == 0) {
            call.reject("Nothing to share");
            return;
        }
        Intent send = new Intent(Intent.ACTION_SEND)
            .setType("text/plain")
            .putExtra(Intent.EXTRA_TEXT, body.toString());
        if (title != null && !title.isEmpty()) send.putExtra(Intent.EXTRA_SUBJECT, title);
        Intent chooser = Intent.createChooser(send, title);
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("No activity");
            return;
        }
        activity.startActivity(chooser);
        JSObject result = new JSObject();
        result.put("shared", true);
        call.resolve(result);
    }
}

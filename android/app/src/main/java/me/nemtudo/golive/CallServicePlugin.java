package me.nemtudo.golive;

import android.content.Intent;
import android.os.Build;
import android.util.Log;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The JS-facing half of {@link CallService}: lib/androidCallService.ts calls
 * {@link #update} while the site is in a call and {@link #stop} when it ends,
 * and hears the notification's buttons as "action" events.
 *
 * <p>No permission is asked for here. RECORD_AUDIO is the page's to ask for,
 * when the mic is first opened (the service picks it up on the next update);
 * POST_NOTIFICATIONS only hides the notification when refused, and the
 * service runs the same without it.
 */
@CapacitorPlugin(name = "CallService")
public class CallServicePlugin extends Plugin {

    private static final String TAG = "GoLiveCall";

    @Override
    public void load() {
        CallService.setActionListener(action -> {
            JSObject data = new JSObject();
            data.put("action", action);
            notifyListeners("action", data);
        });
    }

    @Override
    protected void handleOnDestroy() {
        // The page is going away, and the call with it.
        CallService.setActionListener(null);
        getContext().stopService(new Intent(getContext(), CallService.class));
    }

    @PluginMethod
    public void update(PluginCall call) {
        Intent intent = new Intent(getContext(), CallService.class).setAction(CallService.ACTION_UPDATE);
        intent.putExtra(CallService.EXTRA_TITLE, call.getString("title", ""));
        intent.putExtra(CallService.EXTRA_TEXT, call.getString("text", ""));
        intent.putExtra(CallService.EXTRA_MIC_ON, Boolean.TRUE.equals(call.getBoolean("micOn", false)));
        intent.putExtra(CallService.EXTRA_MUTE_LABEL, call.getString("muteLabel", ""));
        intent.putExtra(CallService.EXTRA_UNMUTE_LABEL, call.getString("unmuteLabel", ""));
        try {
            ContextCompat.startForegroundService(getContext(), intent);
        } catch (RuntimeException ex) {
            // Android 12+ refuses to start a foreground service from the
            // background (ForegroundServiceStartNotAllowedException) — a call
            // that reconnected while the app was away. The page asks again as
            // soon as it is back on screen.
            Log.w(TAG, "could not start the call service", ex);
            call.reject("Não foi possível manter a chamada em segundo plano.", "notAllowed");
            return;
        }
        JSObject result = new JSObject();
        result.put("mic", Build.VERSION.SDK_INT < Build.VERSION_CODES.R || CallService.hasMicPermission(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), CallService.class));
        call.resolve();
    }
}

package me.nemtudo.golive;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.media.projection.MediaProjectionManager;
import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * The JS-facing half of Android screen sharing — see
 * lib/androidScreenCapture.ts for why this exists at all (getDisplayMedia
 * does not) and {@link ScreenCaptureService}, which does the actual capture.
 *
 * This class only ever brokers two things: the system's screen-capture
 * consent dialog (an {@link Activity} result, like any other permission
 * picker) and the {@code POST_NOTIFICATIONS} runtime permission the
 * foreground service's ongoing notification needs on API 33+. Everything
 * else — MediaProjection, the VirtualDisplay, encoding frames — lives in the
 * service, which this plugin only starts and stops.
 */
@CapacitorPlugin(
    name = "ScreenCapture",
    permissions = { @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications") }
)
public class ScreenCapturePlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        // POST_NOTIFICATIONS is a normal (non-dangerous) permission before
        // API 33 — getPermissionState reports GRANTED for it there without
        // ever prompting, so this branch is a no-op on every device that
        // predates the runtime prompt existing at all.
        if (getPermissionState("notifications") == PermissionState.GRANTED) {
            beginCapture(call);
        } else {
            requestPermissionForAlias("notifications", call, "onNotificationsPermissionResult");
        }
    }

    @PermissionCallback
    private void onNotificationsPermissionResult(PluginCall call) {
        // Proceeds either way. Denying POST_NOTIFICATIONS only means the
        // ongoing-share notification cannot be shown — Android still runs
        // the foreground service and the capture itself without it. Refusing
        // to share the screen over a notification permission would confuse
        // a "compartilhar tela" button into looking broken for a completely
        // unrelated reason.
        beginCapture(call);
    }

    private void beginCapture(PluginCall call) {
        MediaProjectionManager manager = (MediaProjectionManager) getContext().getSystemService(
            android.content.Context.MEDIA_PROJECTION_SERVICE
        );
        if (manager == null) {
            call.reject("Captura de tela não suportada neste dispositivo.", "unsupported");
            return;
        }
        // call.setKeepAlive isn't needed here: startActivityForResult below
        // (via bridge.saveCall) already keeps this call alive across the
        // consent dialog on its own.
        startActivityForResult(call, manager.createScreenCaptureIntent(), "onScreenCaptureResult");
    }

    @ActivityCallback
    private void onScreenCaptureResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            // The user tapped "Cancelar" on the system's screen-capture
            // consent dialog — not a failure, the same as dismissing a
            // browser's getDisplayMedia picker. The "cancelled" code is what
            // lib/androidScreenCapture.ts matches on to turn this into the
            // same NotAllowedError useRoomMedia already treats as a silent
            // cancel rather than a shown error.
            call.reject("Compartilhamento de tela cancelado.", "cancelled");
            return;
        }

        ScreenCaptureService.setFrameListener((base64Jpeg, width, height) -> {
            JSObject data = new JSObject();
            data.put("data", base64Jpeg);
            data.put("width", width);
            data.put("height", height);
            notifyListeners("frame", data);
        });
        ScreenCaptureService.setStateListener(() -> {
            JSObject data = new JSObject();
            data.put("state", "stopped");
            notifyListeners("stateChange", data);
        });

        Intent serviceIntent = new Intent(getContext(), ScreenCaptureService.class);
        serviceIntent.putExtra(ScreenCaptureService.EXTRA_RESULT_CODE, result.getResultCode());
        serviceIntent.putExtra(ScreenCaptureService.EXTRA_RESULT_DATA, result.getData());
        serviceIntent.putExtra(ScreenCaptureService.EXTRA_WIDTH, call.getInt("width", 1280));
        serviceIntent.putExtra(ScreenCaptureService.EXTRA_HEIGHT, call.getInt("height", 720));
        serviceIntent.putExtra(ScreenCaptureService.EXTRA_DENSITY, call.getInt("density", 160));
        serviceIntent.putExtra(ScreenCaptureService.EXTRA_FPS, call.getInt("fps", 8));
        ContextCompat.startForegroundService(getContext(), serviceIntent);

        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        ScreenCaptureService.setFrameListener(null);
        ScreenCaptureService.setStateListener(null);
        getContext().stopService(new Intent(getContext(), ScreenCaptureService.class));
        call.resolve();
    }
}

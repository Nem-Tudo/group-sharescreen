package me.nemtudo.golive;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The site's side of the native notifications — see lib/androidNotifications.ts.
 *
 * <p>Its existence is the feature check: the site only registers this device
 * with {@code renderer: "native"} when this plugin is there, because an older
 * build without {@link GoLiveMessagingService} would receive data-only pushes
 * and draw nothing.
 */
@CapacitorPlugin(name = "GoLiveNotifications")
public class GoLiveNotificationsPlugin extends Plugin {

    /**
     * The account token and API address the notification buttons act with
     * (see {@link NotificationActionReceiver}). Sent again whenever either
     * changes; a null token — signing out — forgets both.
     */
    @PluginMethod
    public void setSession(PluginCall call) {
        GoLiveNotifications.setSession(getContext(), call.getString("token"), call.getString("apiBase"));
        call.resolve();
    }

    /** Takes down what the app is already showing. */
    @PluginMethod
    public void clear(PluginCall call) {
        GoLiveNotifications.clearOnOpen(getContext());
        call.resolve();
    }
}

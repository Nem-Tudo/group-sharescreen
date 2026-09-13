package me.nemtudo.golive;

import android.util.Log;
import androidx.annotation.NonNull;
import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;

/**
 * Where FCM messages arrive — replacing the PushNotifications plugin's own
 * service in the manifest, and extending it so the token handling and the
 * {@code pushNotificationReceived} event the site listens for keep working
 * exactly as before.
 *
 * <p>The only addition is drawing the notification. A message with a {@code
 * notification} block never reaches here while the app is in the background
 * (Android draws it itself), so this only ever sees the data-only messages the
 * API sends to devices registered with {@code renderer: "native"}.
 */
public class GoLiveMessagingService extends MessagingService {

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        if (remoteMessage.getNotification() == null && !remoteMessage.getData().isEmpty()) {
            try {
                GoLiveNotifications.render(getApplicationContext(), remoteMessage.getData());
            } catch (Exception e) {
                // A notification that could not be drawn must not also take
                // the site's own event down with it.
                Log.e("GoLiveNotifications", "Could not draw a notification", e);
            }
        }
        super.onMessageReceived(remoteMessage);
    }
}

package me.nemtudo.golive;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import androidx.annotation.Nullable;
import androidx.core.app.RemoteInput;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/**
 * The buttons on GoLive's notifications, pressed without opening the app.
 *
 * <p>Replying, marking read and refusing a call all need the account, and the
 * account lives in the website running inside the WebView — which may not be
 * running at all when the button is pressed. So the site hands its token and
 * API address over (see {@link GoLiveNotificationsPlugin}) and this makes the
 * same HTTP calls the site would, on a background thread kept alive with
 * {@link #goAsync()}.
 *
 * <p>Nothing here reports failure loudly: a reply that did not go is shown as
 * such on the notification itself, and a read mark or a refusal that did not
 * go is the same as the button not having been pressed — the app corrects it
 * the next time it opens.
 */
public class NotificationActionReceiver extends BroadcastReceiver {

    private static final String TAG = "GoLiveNotifications";

    static final String ACTION_REPLY = "me.nemtudo.golive.notification.REPLY";
    static final String ACTION_MARK_READ = "me.nemtudo.golive.notification.MARK_READ";
    static final String ACTION_DISMISS = "me.nemtudo.golive.notification.DISMISS";
    static final String ACTION_DISMISS_ALL = "me.nemtudo.golive.notification.DISMISS_ALL";
    static final String ACTION_DECLINE_CALL = "me.nemtudo.golive.notification.DECLINE_CALL";

    static final String KEY_REPLY_TEXT = "golive.reply";
    private static final String EXTRA_TAG = "golive.tag";
    private static final String EXTRA_CALL_ID = "golive.callId";

    static PendingIntent intent(Context context, String action, String tag) {
        Intent intent = new Intent(context, NotificationActionReceiver.class).setAction(action).putExtra(EXTRA_TAG, tag);
        return PendingIntent.getBroadcast(
            context,
            GoLiveNotifications.requestCode(action + tag),
            intent,
            GoLiveNotifications.immutable(PendingIntent.FLAG_UPDATE_CURRENT)
        );
    }

    /** Mutable, because the system writes the typed text into it. */
    static PendingIntent replyIntent(Context context, String tag) {
        Intent intent = new Intent(context, NotificationActionReceiver.class).setAction(ACTION_REPLY).putExtra(EXTRA_TAG, tag);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags |= PendingIntent.FLAG_MUTABLE;
        return PendingIntent.getBroadcast(context, GoLiveNotifications.requestCode(ACTION_REPLY + tag), intent, flags);
    }

    static PendingIntent declineIntent(Context context, String tag, String callId) {
        Intent intent = new Intent(context, NotificationActionReceiver.class)
            .setAction(ACTION_DECLINE_CALL)
            .putExtra(EXTRA_TAG, tag)
            .putExtra(EXTRA_CALL_ID, callId);
        return PendingIntent.getBroadcast(
            context,
            GoLiveNotifications.requestCode(ACTION_DECLINE_CALL + tag),
            intent,
            GoLiveNotifications.immutable(PendingIntent.FLAG_UPDATE_CURRENT)
        );
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        String tag = intent.getStringExtra(EXTRA_TAG);
        if (action == null || tag == null) return;
        Context app = context.getApplicationContext();

        // The local half first, on this thread: the notification reacts the
        // moment the button is pressed, whatever the network does next.
        switch (action) {
            case ACTION_DISMISS:
                GoLiveNotifications.forgetConversation(app, tag);
                return;
            case ACTION_DISMISS_ALL:
                GoLiveNotifications.forgetAllConversations(app);
                return;
            case ACTION_DECLINE_CALL:
                GoLiveNotifications.cancel(app, tag);
                break;
            default:
                break;
        }

        final CharSequence replyText = ACTION_REPLY.equals(action) ? readReply(intent) : null;
        if (ACTION_REPLY.equals(action) && (replyText == null || replyText.toString().trim().isEmpty())) return;
        final JSONObject conversation = GoLiveNotifications.loadConversation(app, tag);
        if (ACTION_MARK_READ.equals(action)) GoLiveNotifications.forgetConversation(app, tag);

        final PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                switch (action) {
                    case ACTION_REPLY:
                        reply(app, tag, conversation, replyText.toString().trim());
                        break;
                    case ACTION_MARK_READ:
                        markRead(app, conversation);
                        break;
                    case ACTION_DECLINE_CALL:
                        String callId = intent.getStringExtra(EXTRA_CALL_ID);
                        if (callId != null) post(app, "/calls/" + encode(callId) + "/decline", new JSONObject());
                        break;
                    default:
                        break;
                }
            } catch (Exception e) {
                Log.w(TAG, "Notification action failed", e);
            } finally {
                pending.finish();
            }
        }).start();
    }

    @Nullable
    private static CharSequence readReply(Intent intent) {
        Bundle results = RemoteInput.getResultsFromIntent(intent);
        return results == null ? null : results.getCharSequence(KEY_REPLY_TEXT);
    }

    private static void reply(Context context, String tag, @Nullable JSONObject conversation, String text) throws Exception {
        String path = sendPath(conversation);
        if (path == null) {
            GoLiveNotifications.markReplyFailed(context, tag);
            return;
        }
        JSONObject body = new JSONObject();
        body.put("text", text);
        if (post(context, path, body)) {
            GoLiveNotifications.appendOwnReply(context, tag, text);
            markRead(context, conversation);
        } else {
            GoLiveNotifications.markReplyFailed(context, tag);
        }
    }

    private static void markRead(Context context, @Nullable JSONObject conversation) throws Exception {
        String base = conversationPath(conversation);
        if (base != null) post(context, base + "/read", new JSONObject());
    }

    /** Where a message to this conversation is sent. */
    @Nullable
    private static String sendPath(@Nullable JSONObject conversation) {
        String base = conversationPath(conversation);
        if (base == null) return null;
        return conversation.optBoolean("group") ? base + "/messages" : base;
    }

    /**
     * The API's address for this conversation: {@code /dm/:id}, or {@code
     * /groups/:id/channels/:cid}. Sending and the read mark both hang off it.
     */
    @Nullable
    private static String conversationPath(@Nullable JSONObject conversation) {
        if (conversation == null) return null;
        if (conversation.optBoolean("group")) {
            String groupId = conversation.optString("groupId");
            String channelId = conversation.optString("channelId");
            if (groupId.isEmpty() || channelId.isEmpty()) return null;
            return "/groups/" + encode(groupId) + "/channels/" + encode(channelId);
        }
        String fromId = conversation.optString("fromId");
        return fromId.isEmpty() ? null : "/dm/" + encode(fromId);
    }

    private static boolean post(Context context, String path, JSONObject body) {
        String token = GoLiveNotifications.sessionToken(context);
        String api = GoLiveNotifications.sessionApi(context);
        if (token == null || api == null) return false;
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(api.replaceAll("/+$", "") + path).openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(8000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Authorization", "Bearer " + token);
            connection.setRequestProperty("Content-Type", "application/json");
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream out = connection.getOutputStream()) {
                out.write(bytes);
            }
            int status = connection.getResponseCode();
            return status >= 200 && status < 300;
        } catch (Exception e) {
            return false;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static String encode(String value) {
        try {
            return URLEncoder.encode(value, "UTF-8").replace("+", "%20");
        } catch (Exception e) {
            return value;
        }
    }
}

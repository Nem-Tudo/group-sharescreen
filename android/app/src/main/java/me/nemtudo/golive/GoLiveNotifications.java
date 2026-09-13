package me.nemtudo.golive;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.BitmapShader;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.os.Build;
import android.util.Log;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.Person;
import androidx.core.app.RemoteInput;
import androidx.core.content.LocusIdCompat;
import androidx.core.content.pm.ShortcutInfoCompat;
import androidx.core.content.pm.ShortcutManagerCompat;
import androidx.core.graphics.drawable.IconCompat;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Draws GoLive's notifications on Android — the WhatsApp shape rather than a
 * title and a line.
 *
 * <p>Why this exists at all: the API used to send FCM messages with a
 * {@code notification} block, which Android draws by itself with the launcher
 * icon (flattened into a white square), no face, and one row per push. A
 * device registered with {@code renderer: "native"} now gets data-only
 * messages instead (see the API's pushSender), and {@link
 * GoLiveMessagingService} hands them here.
 *
 * <p>What that buys:
 *
 * <ul>
 *   <li>A conversation per person (and per group room): {@link
 *       NotificationCompat.MessagingStyle}, the sender's avatar in a circle,
 *       the last few messages stacked, and a conversation shortcut so Android
 *       11+ files it under "Conversas" with the face as its icon.
 *   <li>"Responder" and "Marcar como lida" right on the notification — see
 *       {@link NotificationActionReceiver}, which acts with the session the
 *       site handed over through {@link GoLiveNotificationsPlugin}.
 *   <li>A summary line ("5 mensagens de 2 conversas") over the group.
 *   <li>A ringing call that behaves like a phone call: full-screen over the
 *       lock screen, Atender/Recusar, ringtone repeating until it stops.
 * </ul>
 *
 * <p>The messages shown so far are kept in SharedPreferences rather than in
 * memory, because the process that receives the second message is very often
 * not the one that received the first — Android starts a fresh one for each
 * push when the app is not running.
 */
final class GoLiveNotifications {

    private static final String TAG = "GoLiveNotifications";

    static final String CHANNEL_MESSAGES = "golive-messages";
    static final String CHANNEL_GROUPS = "golive-groups";
    static final String CHANNEL_CALLS = "golive-incoming-calls";
    static final String CHANNEL_OTHER = "golive-other";
    /**
     * The call channel the site used to create. Its sound is the short
     * notification chime, and a channel's sound cannot be changed once it
     * exists — so calls moved to {@link #CHANNEL_CALLS}, and this one is
     * deleted rather than left in the settings screen doing nothing.
     */
    private static final String LEGACY_CALL_CHANNEL = "golive-calls";

    private static final String GROUP_KEY = "me.nemtudo.golive.MESSAGES";
    private static final String SUMMARY_TAG = "golive-summary";
    /** Every notification here is addressed by its tag; the id is constant. */
    static final int NOTIFICATION_ID = 1;

    private static final String PREFS = "golive_notifications";
    private static final String CONVERSATION_PREFIX = "conv:";
    private static final String SESSION_TOKEN = "session.token";
    private static final String SESSION_API = "session.api";

    /** How many messages one conversation shows before the oldest go. */
    private static final int MAX_MESSAGES = 7;
    private static final int AVATAR_SIZE = 192;

    static final String EXTRA_CALL_ACTION = "golive.callAction";
    static final String CALL_ACTION_RING = "ring";
    static final String CALL_ACTION_ACCEPT = "accept";

    private GoLiveNotifications() {}

    // ─── Entry point ─────────────────────────────────────────────────────

    /** One push, as the API's PushPayload flattened to strings. */
    static void render(Context context, Map<String, String> data) {
        ensureChannels(context);
        String kind = value(data, "kind");
        switch (kind) {
            case "dm":
                if (!value(data, "fromId").isEmpty()) {
                    showMessage(context, data, false);
                    return;
                }
                break;
            case "group-message":
                if (!value(data, "channelId").isEmpty() || !value(data, "tag").isEmpty()) {
                    showMessage(context, data, true);
                    return;
                }
                break;
            case "call":
                showIncomingCall(context, data);
                return;
            case "call-ended":
                showCallEnded(context, data);
                return;
            default:
                break;
        }
        showSimple(context, data);
    }

    // ─── Channels ────────────────────────────────────────────────────────

    /**
     * Creates the channels this renderer uses. Idempotent: creating a channel
     * that exists changes nothing the person set on it, so this runs before
     * every notification rather than being tracked.
     */
    static void ensureChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;

        NotificationChannel messages = new NotificationChannel(
            CHANNEL_MESSAGES,
            context.getString(R.string.notif_channel_messages),
            NotificationManager.IMPORTANCE_HIGH
        );
        messages.setDescription(context.getString(R.string.notif_channel_messages_desc));
        messages.enableVibration(true);
        messages.setShowBadge(true);
        manager.createNotificationChannel(messages);

        NotificationChannel groups = new NotificationChannel(
            CHANNEL_GROUPS,
            context.getString(R.string.notif_channel_groups),
            NotificationManager.IMPORTANCE_HIGH
        );
        groups.setDescription(context.getString(R.string.notif_channel_groups_desc));
        groups.enableVibration(true);
        groups.setShowBadge(true);
        manager.createNotificationChannel(groups);

        NotificationChannel calls = new NotificationChannel(
            CHANNEL_CALLS,
            context.getString(R.string.notif_channel_calls),
            NotificationManager.IMPORTANCE_HIGH
        );
        calls.setDescription(context.getString(R.string.notif_channel_calls_desc));
        // The ringtone, with ringtone attributes — which is what routes it
        // through the ring volume and lets Do Not Disturb treat it as a call.
        calls.setSound(
            RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
            new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
        );
        calls.enableVibration(true);
        calls.setVibrationPattern(new long[] { 0, 1000, 1000 });
        calls.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        manager.createNotificationChannel(calls);

        NotificationChannel other = new NotificationChannel(
            CHANNEL_OTHER,
            context.getString(R.string.notif_channel_other),
            NotificationManager.IMPORTANCE_DEFAULT
        );
        other.setDescription(context.getString(R.string.notif_channel_other_desc));
        manager.createNotificationChannel(other);

        if (manager.getNotificationChannel(LEGACY_CALL_CHANNEL) != null) {
            manager.deleteNotificationChannel(LEGACY_CALL_CHANNEL);
        }
    }

    // ─── Conversations ───────────────────────────────────────────────────

    private static void showMessage(Context context, Map<String, String> data, boolean group) {
        String tag = value(data, "tag");
        if (tag.isEmpty()) {
            tag = group ? "group:" + value(data, "channelId") : "dm:" + value(data, "fromId");
        }

        JSONObject conversation = loadConversation(context, tag);
        try {
            if (conversation == null) conversation = new JSONObject();
            conversation.put("tag", tag);
            conversation.put("group", group);
            conversation.put("kind", value(data, "kind"));
            conversation.put("url", value(data, "url"));
            // Only a DM is *with* somebody; a group room is addressed by its ids.
            if (!group) conversation.put("fromId", value(data, "fromId"));
            conversation.put("groupId", value(data, "groupId"));
            conversation.put("channelId", value(data, "channelId"));
            conversation.put("icon", value(data, "icon"));
            String title = group
                ? firstNonEmpty(value(data, "conversationTitle"), value(data, "title"))
                : firstNonEmpty(value(data, "fromName"), value(data, "title"));
            conversation.put("title", title);
            if (!group) conversation.put("avatar", value(data, "avatar"));
            conversation.remove("error");

            JSONArray messages = conversation.optJSONArray("messages");
            if (messages == null) messages = new JSONArray();
            String messageId = value(data, "messageId");
            // A retried push must not show the same line twice.
            if (!messageId.isEmpty()) {
                for (int i = 0; i < messages.length(); i++) {
                    if (messageId.equals(messages.getJSONObject(i).optString("id"))) return;
                }
            }
            JSONObject message = new JSONObject();
            message.put("id", messageId);
            message.put("text", firstNonEmpty(value(data, "text"), value(data, "body")));
            message.put("ts", parseLong(value(data, "sentAt"), System.currentTimeMillis()));
            message.put("name", firstNonEmpty(value(data, "fromName"), title));
            message.put("senderId", value(data, "fromId"));
            message.put("avatar", value(data, "avatar"));
            message.put("mine", false);
            messages.put(message);
            conversation.put("messages", trim(messages));
            conversation.put("unread", conversation.optInt("unread", 0) + 1);
        } catch (Exception e) {
            Log.w(TAG, "Could not record the message", e);
            return;
        }

        saveConversation(context, tag, conversation);
        postConversation(context, conversation, false);
        postSummary(context);
    }

    /**
     * Adds what this person just sent from the notification itself, so the
     * conversation on screen shows the reply under the message it answers —
     * which is what tells somebody it went.
     */
    static void appendOwnReply(Context context, String tag, String text) {
        JSONObject conversation = loadConversation(context, tag);
        if (conversation == null) return;
        try {
            JSONArray messages = conversation.optJSONArray("messages");
            if (messages == null) messages = new JSONArray();
            JSONObject message = new JSONObject();
            message.put("text", text);
            message.put("ts", System.currentTimeMillis());
            message.put("mine", true);
            messages.put(message);
            conversation.put("messages", trim(messages));
            // Answering is reading.
            conversation.put("unread", 0);
            conversation.remove("error");
        } catch (Exception e) {
            return;
        }
        saveConversation(context, tag, conversation);
        postConversation(context, conversation, true);
        postSummary(context);
    }

    /** Re-draws the conversation with a line saying the reply did not go. */
    static void markReplyFailed(Context context, String tag) {
        JSONObject conversation = loadConversation(context, tag);
        if (conversation == null) return;
        try {
            conversation.put("error", context.getString(R.string.notif_reply_failed));
        } catch (Exception e) {
            return;
        }
        saveConversation(context, tag, conversation);
        postConversation(context, conversation, true);
    }

    private static void postConversation(Context context, JSONObject conversation, boolean silent) {
        if (!canPost(context)) return;
        String tag = conversation.optString("tag");
        boolean group = conversation.optBoolean("group");
        String title = conversation.optString("title");
        JSONArray messages = conversation.optJSONArray("messages");
        if (messages == null || messages.length() == 0) return;

        Person me = new Person.Builder().setName(context.getString(R.string.notif_you)).setKey("me").build();
        NotificationCompat.MessagingStyle style = new NotificationCompat.MessagingStyle(me);
        if (group) {
            style.setConversationTitle(title);
            style.setGroupConversation(true);
        }

        Map<String, Person> people = new HashMap<>();
        Bitmap conversationImage;
        if (group) {
            conversationImage = avatar(context, conversation.optString("icon"), title, tag);
        } else {
            conversationImage = avatar(context, conversation.optString("avatar"), title, conversation.optString("fromId"));
        }

        long lastTs = 0;
        for (int i = 0; i < messages.length(); i++) {
            JSONObject message = messages.optJSONObject(i);
            if (message == null) continue;
            long ts = message.optLong("ts", System.currentTimeMillis());
            lastTs = Math.max(lastTs, ts);
            Person sender = null;
            if (!message.optBoolean("mine")) {
                String senderId = message.optString("senderId");
                String key = senderId.isEmpty() ? message.optString("name") : senderId;
                sender = people.get(key);
                if (sender == null) {
                    Bitmap face = !group
                        ? conversationImage
                        : avatar(context, message.optString("avatar"), message.optString("name"), key);
                    sender = new Person.Builder()
                        .setName(message.optString("name"))
                        .setKey(key)
                        .setIcon(IconCompat.createWithBitmap(face))
                        .build();
                    people.put(key, sender);
                }
            }
            style.addMessage(new NotificationCompat.MessagingStyle.Message(message.optString("text"), ts, sender));
        }

        String shortcutId = publishShortcut(context, conversation, conversationImage, group ? null : people.values());
        int unread = conversation.optInt("unread", 0);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, group ? CHANNEL_GROUPS : CHANNEL_MESSAGES)
            .setSmallIcon(R.drawable.ic_stat_golive)
            .setColor(context.getColor(R.color.golive_brand))
            .setStyle(style)
            .setContentTitle(title)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setGroup(GROUP_KEY)
            .setAutoCancel(true)
            .setOnlyAlertOnce(silent)
            .setShowWhen(true)
            .setWhen(lastTs > 0 ? lastTs : System.currentTimeMillis())
            .setNumber(unread)
            .setContentIntent(openAppIntent(context, conversation, tag))
            .setDeleteIntent(NotificationActionReceiver.intent(context, NotificationActionReceiver.ACTION_DISMISS, tag))
            .setPublicVersion(publicVersion(context, Math.max(unread, 1)));

        // Android before 9 shows no sender faces inside the style; the large
        // icon is how the conversation still has one there.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P || group) {
            builder.setLargeIcon(conversationImage);
        }
        if (shortcutId != null) {
            builder.setShortcutId(shortcutId);
            builder.setLocusId(new LocusIdCompat(shortcutId));
        }
        String error = conversation.optString("error");
        if (!error.isEmpty()) builder.setSubText(error);

        if (hasSession(context)) {
            RemoteInput input = new RemoteInput.Builder(NotificationActionReceiver.KEY_REPLY_TEXT)
                .setLabel(context.getString(R.string.notif_reply_hint))
                .build();
            NotificationCompat.Action reply = new NotificationCompat.Action.Builder(
                R.drawable.ic_stat_golive,
                context.getString(R.string.notif_reply),
                NotificationActionReceiver.replyIntent(context, tag)
            )
                .addRemoteInput(input)
                .setAllowGeneratedReplies(true)
                .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
                .setShowsUserInterface(false)
                .build();
            NotificationCompat.Action read = new NotificationCompat.Action.Builder(
                R.drawable.ic_stat_golive,
                context.getString(R.string.notif_mark_read),
                NotificationActionReceiver.intent(context, NotificationActionReceiver.ACTION_MARK_READ, tag)
            )
                .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_MARK_AS_READ)
                .setShowsUserInterface(false)
                .build();
            builder.addAction(reply);
            builder.addAction(read);
        }

        notify(context, tag, builder.build());
    }

    /** What the lock screen shows when it hides the content. */
    private static Notification publicVersion(Context context, int count) {
        return new NotificationCompat.Builder(context, CHANNEL_MESSAGES)
            .setSmallIcon(R.drawable.ic_stat_golive)
            .setColor(context.getColor(R.color.golive_brand))
            .setContentTitle(context.getString(R.string.app_name))
            .setContentText(context.getResources().getQuantityString(R.plurals.notif_new_messages, count, count))
            .build();
    }

    /**
     * The line over the stack: "3 novas mensagens", or "5 mensagens de 2
     * conversas" once more than one conversation is waiting.
     */
    private static void postSummary(Context context) {
        if (!canPost(context)) return;
        List<JSONObject> conversations = loadConversations(context);
        if (conversations.isEmpty()) {
            NotificationManagerCompat.from(context).cancel(SUMMARY_TAG, NOTIFICATION_ID);
            return;
        }
        int total = 0;
        NotificationCompat.InboxStyle inbox = new NotificationCompat.InboxStyle();
        List<JSONObject> lines = new ArrayList<>();
        for (JSONObject conversation : conversations) {
            total += Math.max(conversation.optInt("unread", 0), 0);
            JSONArray messages = conversation.optJSONArray("messages");
            if (messages == null) continue;
            for (int i = 0; i < messages.length(); i++) {
                JSONObject message = messages.optJSONObject(i);
                if (message == null || message.optBoolean("mine")) continue;
                JSONObject line = new JSONObject();
                try {
                    String name = message.optString("name");
                    String prefix = conversation.optBoolean("group")
                        ? name + " @ " + conversation.optString("title")
                        : name;
                    line.put("text", prefix + ": " + message.optString("text"));
                    line.put("ts", message.optLong("ts"));
                } catch (Exception ignored) {
                    continue;
                }
                lines.add(line);
            }
        }
        Collections.sort(lines, (a, b) -> Long.compare(b.optLong("ts"), a.optLong("ts")));
        for (int i = 0; i < Math.min(lines.size(), 6); i++) inbox.addLine(lines.get(i).optString("text"));
        total = Math.max(total, 1);

        String messagesText = context.getResources().getQuantityString(R.plurals.notif_messages, total, total);
        String summary = conversations.size() > 1
            ? context.getString(
                R.string.notif_summary_many,
                messagesText,
                context.getResources().getQuantityString(R.plurals.notif_chats, conversations.size(), conversations.size())
            )
            : context.getResources().getQuantityString(R.plurals.notif_new_messages, total, total);
        inbox.setSummaryText(summary);

        Intent open = new Intent(context, MainActivity.class)
            .setAction("me.nemtudo.golive.OPEN_APP")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);

        Notification notification = new NotificationCompat.Builder(context, CHANNEL_MESSAGES)
            .setSmallIcon(R.drawable.ic_stat_golive)
            .setColor(context.getColor(R.color.golive_brand))
            .setContentTitle(context.getString(R.string.app_name))
            .setContentText(summary)
            .setSubText(summary)
            .setStyle(inbox)
            .setGroup(GROUP_KEY)
            .setGroupSummary(true)
            // The conversations make the noise; the summary only organises.
            .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
            .setOnlyAlertOnce(true)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setContentIntent(PendingIntent.getActivity(context, 0, open, immutable(PendingIntent.FLAG_UPDATE_CURRENT)))
            .setDeleteIntent(NotificationActionReceiver.intent(context, NotificationActionReceiver.ACTION_DISMISS_ALL, SUMMARY_TAG))
            .build();
        notify(context, SUMMARY_TAG, notification);
    }

    /**
     * A conversation shortcut, which is what Android 11+ needs to put the
     * notification in the "Conversas" section with the person's face as its
     * icon, and to offer it as a priority conversation. Best effort: a
     * launcher refusing shortcuts leaves an ordinary notification behind.
     */
    @Nullable
    private static String publishShortcut(
        Context context,
        JSONObject conversation,
        Bitmap image,
        @Nullable Iterable<Person> people
    ) {
        String id = conversation.optString("tag");
        if (id.isEmpty()) return null;
        try {
            Intent intent = openIntent(context, conversation, id).setAction(Intent.ACTION_VIEW);
            ShortcutInfoCompat.Builder builder = new ShortcutInfoCompat.Builder(context, id)
                .setShortLabel(conversation.optString("title", context.getString(R.string.app_name)))
                .setLongLived(true)
                .setIcon(IconCompat.createWithBitmap(image))
                .setIntent(intent)
                .setLocusId(new LocusIdCompat(id));
            if (people != null) {
                for (Person person : people) {
                    builder.setPerson(person);
                    break;
                }
            }
            ShortcutManagerCompat.pushDynamicShortcut(context, builder.build());
            return id;
        } catch (Exception e) {
            Log.w(TAG, "Shortcut refused", e);
            return null;
        }
    }

    // ─── Calls ───────────────────────────────────────────────────────────

    private static void showIncomingCall(Context context, Map<String, String> data) {
        if (!canPost(context)) return;
        String callId = value(data, "callId");
        if (callId.isEmpty()) return;
        String tag = firstNonEmpty(value(data, "tag"), "call:" + callId);
        long now = System.currentTimeMillis();
        long expiresAt = parseLong(value(data, "expiresAt"), now + 45_000);
        // A push the phone only received after the caller gave up.
        if (expiresAt <= now) return;

        String name = firstNonEmpty(value(data, "fromName"), context.getString(R.string.notif_incoming_call));
        Bitmap face = avatar(context, value(data, "avatar"), name, value(data, "fromId"));
        Person caller = new Person.Builder()
            .setName(name)
            .setKey(value(data, "fromId"))
            .setIcon(IconCompat.createWithBitmap(face))
            .setImportant(true)
            .build();

        Map<String, String> ringData = new HashMap<>(data);
        ringData.put(EXTRA_CALL_ACTION, CALL_ACTION_RING);
        Map<String, String> acceptData = new HashMap<>(data);
        acceptData.put(EXTRA_CALL_ACTION, CALL_ACTION_ACCEPT);

        PendingIntent ring = activityIntent(context, ringData, tag + ":ring");
        PendingIntent accept = activityIntent(context, acceptData, tag + ":accept");
        PendingIntent decline = NotificationActionReceiver.declineIntent(context, tag, callId);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_CALLS)
            .setSmallIcon(R.drawable.ic_stat_golive)
            .setColor(context.getColor(R.color.golive_brand))
            .setContentTitle(name)
            // The app's own words rather than the push's body, which the API
            // writes in one language for every phone.
            .setContentText(context.getString(R.string.notif_incoming_call))
            .setLargeIcon(face)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setContentIntent(ring)
            .setFullScreenIntent(ring, true)
            .setTimeoutAfter(expiresAt - now)
            .setStyle(NotificationCompat.CallStyle.forIncomingCall(caller, decline, accept));

        Notification notification = builder.build();
        // Rings until answered, refused or timed out — not one chime.
        notification.flags |= Notification.FLAG_INSISTENT;
        notify(context, tag, notification);
    }

    /**
     * The ring is over. Whatever was ringing goes, and a missed call takes its
     * place — the API only sends this for a call that timed out or that the
     * caller cancelled, never for one this person refused.
     */
    private static void showCallEnded(Context context, Map<String, String> data) {
        String callId = value(data, "callId");
        String tag = firstNonEmpty(value(data, "tag"), "call:" + callId);
        NotificationManagerCompat.from(context).cancel(tag, NOTIFICATION_ID);
        if (!canPost(context)) return;

        String name = value(data, "fromName");
        Bitmap face = avatar(context, value(data, "avatar"), name, value(data, "fromId"));
        String missedTag = "missed:" + firstNonEmpty(value(data, "fromId"), callId);
        Notification notification = new NotificationCompat.Builder(context, CHANNEL_OTHER)
            .setSmallIcon(R.drawable.ic_stat_golive)
            .setColor(context.getColor(R.color.golive_brand))
            .setContentTitle(firstNonEmpty(name, value(data, "title")))
            .setContentText(context.getString(R.string.notif_missed_call))
            .setLargeIcon(face)
            .setCategory(NotificationCompat.CATEGORY_MISSED_CALL)
            .setAutoCancel(true)
            .setShowWhen(true)
            .setContentIntent(activityIntent(context, data, missedTag))
            .build();
        notify(context, missedTag, notification);
    }

    /** Cancels a ring — from Recusar, or when the app takes over. */
    static void cancel(Context context, String tag) {
        NotificationManagerCompat.from(context).cancel(tag, NOTIFICATION_ID);
    }

    // ─── Everything else ─────────────────────────────────────────────────

    private static void showSimple(Context context, Map<String, String> data) {
        if (!canPost(context)) return;
        String tag = firstNonEmpty(value(data, "tag"), "golive:" + System.currentTimeMillis());
        String title = value(data, "title");
        String body = value(data, "body");
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_OTHER)
            .setSmallIcon(R.drawable.ic_stat_golive)
            .setColor(context.getColor(R.color.golive_brand))
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setShowWhen(true)
            .setContentIntent(activityIntent(context, data, tag));
        String image = firstNonEmpty(value(data, "avatar"), value(data, "icon"));
        if (!image.isEmpty()) {
            builder.setLargeIcon(avatar(context, image, firstNonEmpty(value(data, "fromName"), title), value(data, "fromId")));
        }
        notify(context, tag, builder.build());
    }

    // ─── Clearing ────────────────────────────────────────────────────────

    /**
     * The app came to the front: everything it was announcing is now on screen
     * inside it. Message conversations and a ringing call go — the ring
     * screen in the app takes over the call — while a missed call or a like
     * stays until it is looked at, like it would anywhere else.
     */
    static void clearOnOpen(Context context) {
        forgetAllConversations(context);
        NotificationManagerCompat manager = NotificationManagerCompat.from(context);
        manager.cancel(SUMMARY_TAG, NOTIFICATION_ID);
        NotificationManager platform = context.getSystemService(NotificationManager.class);
        if (platform == null) return;
        for (android.service.notification.StatusBarNotification active : platform.getActiveNotifications()) {
            String tag = active.getTag();
            if (tag != null && tag.startsWith("call:")) manager.cancel(tag, active.getId());
        }
    }

    /** One conversation read or swiped away. */
    static void forgetConversation(Context context, String tag) {
        prefs(context).edit().remove(CONVERSATION_PREFIX + tag).apply();
        NotificationManagerCompat.from(context).cancel(tag, NOTIFICATION_ID);
        postSummary(context);
    }

    /** The whole stack swiped away. */
    static void forgetAllConversations(Context context) {
        NotificationManagerCompat manager = NotificationManagerCompat.from(context);
        SharedPreferences.Editor editor = prefs(context).edit();
        for (JSONObject conversation : loadConversations(context)) {
            String tag = conversation.optString("tag");
            editor.remove(CONVERSATION_PREFIX + tag);
            manager.cancel(tag, NOTIFICATION_ID);
        }
        editor.apply();
    }

    // ─── Session ─────────────────────────────────────────────────────────

    static void setSession(Context context, @Nullable String token, @Nullable String apiBase) {
        SharedPreferences.Editor editor = prefs(context).edit();
        if (token == null || token.isEmpty() || apiBase == null || apiBase.isEmpty()) {
            editor.remove(SESSION_TOKEN).remove(SESSION_API);
        } else {
            editor.putString(SESSION_TOKEN, token).putString(SESSION_API, apiBase);
        }
        editor.apply();
    }

    static boolean hasSession(Context context) {
        return sessionToken(context) != null && sessionApi(context) != null;
    }

    @Nullable
    static String sessionToken(Context context) {
        return prefs(context).getString(SESSION_TOKEN, null);
    }

    @Nullable
    static String sessionApi(Context context) {
        return prefs(context).getString(SESSION_API, null);
    }

    // ─── Storage ─────────────────────────────────────────────────────────

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    @Nullable
    static JSONObject loadConversation(Context context, String tag) {
        String raw = prefs(context).getString(CONVERSATION_PREFIX + tag, null);
        if (raw == null) return null;
        try {
            return new JSONObject(raw);
        } catch (Exception e) {
            return null;
        }
    }

    private static void saveConversation(Context context, String tag, JSONObject conversation) {
        // commit rather than apply: the process may be torn down the moment
        // this push has been handled, and the next one has to find this.
        prefs(context).edit().putString(CONVERSATION_PREFIX + tag, conversation.toString()).commit();
    }

    private static List<JSONObject> loadConversations(Context context) {
        List<JSONObject> out = new ArrayList<>();
        for (Map.Entry<String, ?> entry : prefs(context).getAll().entrySet()) {
            if (!entry.getKey().startsWith(CONVERSATION_PREFIX)) continue;
            try {
                out.add(new JSONObject(String.valueOf(entry.getValue())));
            } catch (Exception ignored) {
                // A row this build cannot read is a row it cannot show.
            }
        }
        return out;
    }

    private static JSONArray trim(JSONArray messages) {
        if (messages.length() <= MAX_MESSAGES) return messages;
        JSONArray out = new JSONArray();
        for (int i = messages.length() - MAX_MESSAGES; i < messages.length(); i++) out.put(messages.opt(i));
        return out;
    }

    // ─── Intents ─────────────────────────────────────────────────────────

    /**
     * Opening the app on what the notification was about.
     *
     * The extras carry the push's own fields plus {@code google.message_id},
     * which is the marker the PushNotifications plugin looks for to fire
     * {@code pushNotificationActionPerformed} — so the site's existing routing
     * (lib/pushRegistration.ts) opens the conversation exactly as it did for
     * the notifications Android used to draw.
     */
    private static PendingIntent openAppIntent(Context context, JSONObject conversation, String tag) {
        Intent intent = openIntent(context, conversation, tag);
        return PendingIntent.getActivity(context, requestCode(tag + ":open"), intent, immutable(PendingIntent.FLAG_UPDATE_CURRENT));
    }

    private static Intent openIntent(Context context, JSONObject conversation, String tag) {
        Intent intent = new Intent(context, MainActivity.class)
            .setAction("me.nemtudo.golive.OPEN:" + tag)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra("google.message_id", tag)
            .putExtra("kind", conversation.optString("kind"))
            .putExtra("tag", tag)
            .putExtra("url", conversation.optString("url"));
        String fromId = conversation.optString("fromId");
        if (!fromId.isEmpty()) intent.putExtra("fromId", fromId);
        String groupId = conversation.optString("groupId");
        if (!groupId.isEmpty()) intent.putExtra("groupId", groupId);
        String channelId = conversation.optString("channelId");
        if (!channelId.isEmpty()) intent.putExtra("channelId", channelId);
        return intent;
    }

    private static PendingIntent activityIntent(Context context, Map<String, String> data, String key) {
        Intent intent = new Intent(context, MainActivity.class)
            .setAction("me.nemtudo.golive.OPEN:" + key)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra("google.message_id", key);
        for (Map.Entry<String, String> entry : data.entrySet()) {
            if (entry.getKey().startsWith("google.") || entry.getValue() == null) continue;
            intent.putExtra(entry.getKey(), entry.getValue());
        }
        return PendingIntent.getActivity(context, requestCode(key), intent, immutable(PendingIntent.FLAG_UPDATE_CURRENT));
    }

    static int requestCode(String key) {
        return key.hashCode();
    }

    static int immutable(int flags) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? flags | PendingIntent.FLAG_IMMUTABLE : flags;
    }

    // ─── Avatars ─────────────────────────────────────────────────────────

    /**
     * A face in a circle: the picture at {@code url} when it can be had, or
     * the first letter of the name on a colour picked from {@code key} —
     * the same person always gets the same colour.
     */
    static Bitmap avatar(Context context, @Nullable String url, @Nullable String name, @Nullable String key) {
        Bitmap source = null;
        if (url != null && url.startsWith("https://")) source = loadImage(context, url);
        if (source == null) return letterAvatar(name, key);
        return circle(source);
    }

    @Nullable
    private static Bitmap loadImage(Context context, String url) {
        File dir = new File(context.getCacheDir(), "notification-avatars");
        File file = new File(dir, sha1(url) + ".png");
        if (file.exists()) {
            Bitmap cached = BitmapFactory.decodeFile(file.getPath());
            if (cached != null) return cached;
        }
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setConnectTimeout(4000);
            connection.setReadTimeout(4000);
            connection.setInstanceFollowRedirects(true);
            if (connection.getResponseCode() != 200) return null;
            byte[] bytes;
            try (InputStream in = connection.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                int read;
                int total = 0;
                while ((read = in.read(buffer)) != -1) {
                    total += read;
                    // An avatar has no business being this big; decoding one
                    // that is would be the thing that gets this process killed.
                    if (total > 5 * 1024 * 1024) return null;
                    out.write(buffer, 0, read);
                }
                bytes = out.toByteArray();
            }
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
            int sample = 1;
            while (bounds.outWidth / (sample * 2) >= AVATAR_SIZE && bounds.outHeight / (sample * 2) >= AVATAR_SIZE) sample *= 2;
            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inSampleSize = sample;
            Bitmap decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
            if (decoded == null) return null;
            Bitmap scaled = squareCrop(decoded);
            if (dir.exists() || dir.mkdirs()) {
                try (OutputStream out = new FileOutputStream(file)) {
                    scaled.compress(Bitmap.CompressFormat.PNG, 100, out);
                } catch (Exception ignored) {
                    // Only the cache is lost.
                }
            }
            return scaled;
        } catch (Exception e) {
            return null;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static Bitmap squareCrop(Bitmap source) {
        int side = Math.min(source.getWidth(), source.getHeight());
        Bitmap out = Bitmap.createBitmap(AVATAR_SIZE, AVATAR_SIZE, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(out);
        Rect from = new Rect(
            (source.getWidth() - side) / 2,
            (source.getHeight() - side) / 2,
            (source.getWidth() + side) / 2,
            (source.getHeight() + side) / 2
        );
        canvas.drawBitmap(source, from, new Rect(0, 0, AVATAR_SIZE, AVATAR_SIZE), new Paint(Paint.FILTER_BITMAP_FLAG));
        return out;
    }

    private static Bitmap circle(Bitmap source) {
        Bitmap square = source.getWidth() == AVATAR_SIZE && source.getHeight() == AVATAR_SIZE ? source : squareCrop(source);
        Bitmap out = Bitmap.createBitmap(AVATAR_SIZE, AVATAR_SIZE, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(out);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
        BitmapShader shader = new BitmapShader(square, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP);
        shader.setLocalMatrix(new Matrix());
        paint.setShader(shader);
        float r = AVATAR_SIZE / 2f;
        canvas.drawCircle(r, r, r, paint);
        return out;
    }

    private static final int[] AVATAR_COLORS = {
        0xFF0099FF, 0xFF7C3AED, 0xFFDB2777, 0xFFEA580C, 0xFF16A34A, 0xFF0891B2, 0xFFCA8A04, 0xFF4F46E5,
    };

    private static Bitmap letterAvatar(@Nullable String name, @Nullable String key) {
        Bitmap out = Bitmap.createBitmap(AVATAR_SIZE, AVATAR_SIZE, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(out);
        String seed = key != null && !key.isEmpty() ? key : (name != null ? name : "");
        Paint background = new Paint(Paint.ANTI_ALIAS_FLAG);
        background.setColor(AVATAR_COLORS[Math.abs(seed.hashCode() % AVATAR_COLORS.length)]);
        float r = AVATAR_SIZE / 2f;
        canvas.drawCircle(r, r, r, background);

        String trimmed = name != null ? name.trim() : "";
        String letter = trimmed.isEmpty() ? "?" : new String(Character.toChars(trimmed.codePointAt(0))).toUpperCase();
        Paint text = new Paint(Paint.ANTI_ALIAS_FLAG);
        text.setColor(Color.WHITE);
        text.setTextSize(AVATAR_SIZE * 0.45f);
        text.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        text.setTextAlign(Paint.Align.CENTER);
        Rect bounds = new Rect();
        text.getTextBounds(letter, 0, letter.length(), bounds);
        canvas.drawText(letter, r, r + bounds.height() / 2f, text);
        return out;
    }

    // ─── Helpers ─────────────────────────────────────────────────────────

    private static void notify(Context context, String tag, Notification notification) {
        try {
            NotificationManagerCompat.from(context).notify(tag, NOTIFICATION_ID, notification);
        } catch (SecurityException e) {
            // Permission withdrawn between the check and the post.
        }
    }

    private static boolean canPost(Context context) {
        return NotificationManagerCompat.from(context).areNotificationsEnabled();
    }

    private static String value(Map<String, String> data, String key) {
        String v = data.get(key);
        return v == null ? "" : v;
    }

    private static String firstNonEmpty(String... values) {
        for (String v : values) if (v != null && !v.isEmpty()) return v;
        return "";
    }

    private static long parseLong(String raw, long fallback) {
        try {
            return raw == null || raw.isEmpty() ? fallback : Long.parseLong(raw);
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private static String sha1(String input) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-1").digest(input.getBytes(StandardCharsets.UTF_8));
            StringBuilder out = new StringBuilder();
            for (byte b : digest) out.append(String.format("%02x", b));
            return out.toString();
        } catch (Exception e) {
            return Integer.toHexString(input.hashCode());
        }
    }
}

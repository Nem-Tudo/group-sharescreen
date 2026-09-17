package me.nemtudo.golive;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.Person;
import androidx.core.content.ContextCompat;

/**
 * Keeps a call alive while the app is out of sight — see
 * lib/androidCallService.ts, which starts it for as long as the site holds a
 * room (a room, a group's voice room, a direct call: they are all one
 * WatchRoom).
 *
 * <p>Without it, leaving the app mid-call broke both halves of the call:
 * <ul>
 *   <li>The microphone. From Android 9 a process that is not in the
 *       foreground is fed silence by every AudioRecord — getUserMedia's
 *       included — and from Android 11 only a foreground service of type
 *       {@code microphone}, started while the app was on screen, lifts that.
 *       The call stayed up; nobody heard you.</li>
 *   <li>Everything else. A process with no visible activity and no
 *       foreground service is a cached one, which Android 12+ freezes within
 *       seconds (and OEM battery layers kill): the room's sound stopped, and
 *       then its socket did.</li>
 * </ul>
 *
 * <p>So this runs as {@code mediaPlayback} always and adds {@code microphone}
 * whenever RECORD_AUDIO is granted — whether or not the mic is open right now,
 * because the type cannot be added later from the background, and the
 * notification's own button is how somebody unmutes from there. It also holds
 * a partial wake lock and a Wi-Fi lock, so a phone in a pocket with the screen
 * off keeps its CPU and radio awake for the call the way a phone call does.
 *
 * <p>The notification is the call's, not a technicality: the room's name, a
 * mute button and a hang-up button. Both buttons are only relayed to the
 * page ({@link #setActionListener}); what muting and leaving mean is the
 * site's business. The mute button's label comes from the page, already
 * translated; the hang-up one is CallStyle's own, in the system's language.
 *
 * <p>Started and updated with the same intent — startForegroundService on a
 * running service just delivers another onStartCommand — and stopped by the
 * page when the call ends, or by the task being swiped away, which takes the
 * WebView and so the call with it.
 */
public class CallService extends Service {

    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_TEXT = "text";
    public static final String EXTRA_MIC_ON = "micOn";
    public static final String EXTRA_MUTE_LABEL = "muteLabel";
    public static final String EXTRA_UNMUTE_LABEL = "unmuteLabel";

    static final String ACTION_UPDATE = "me.nemtudo.golive.call.UPDATE";
    static final String ACTION_TOGGLE_MIC = "me.nemtudo.golive.call.TOGGLE_MIC";
    static final String ACTION_LEAVE = "me.nemtudo.golive.call.LEAVE";

    private static final String TAG = "GoLiveCall";
    private static final String CHANNEL_ID = "golive_call";
    private static final int NOTIFICATION_ID = 4822;

    public interface ActionListener {
        /** "toggleMic" or "leave". */
        void onAction(String action);
    }

    // Static for the same reason as ScreenCaptureService's listeners: the
    // plugin never gets hold of the Service instance.
    @Nullable
    private static volatile ActionListener actionListener;

    public static void setActionListener(@Nullable ActionListener listener) {
        actionListener = listener;
    }

    private String title = "GoLive";
    private String text = "";
    private boolean micOn = false;
    private String muteLabel = "Mutar";
    private String unmuteLabel = "Desmutar";

    @Nullable
    private PowerManager.WakeLock wakeLock;
    @Nullable
    private WifiManager.WifiLock wifiLock;

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            // Restarted by the system after the process died: there is no
            // page, so there is no call to keep.
            stopSelf();
            return START_NOT_STICKY;
        }
        String action = intent.getAction();
        if (ACTION_TOGGLE_MIC.equals(action) || ACTION_LEAVE.equals(action)) {
            ActionListener listener = actionListener;
            if (listener != null) listener.onAction(ACTION_LEAVE.equals(action) ? "leave" : "toggleMic");
            // Nobody to tell means the page is gone, and a call notification
            // with no call behind it is worse than none.
            else stopSelf();
            return START_NOT_STICKY;
        }

        title = stringExtra(intent, EXTRA_TITLE, title);
        text = stringExtra(intent, EXTRA_TEXT, text);
        micOn = intent.getBooleanExtra(EXTRA_MIC_ON, micOn);
        muteLabel = stringExtra(intent, EXTRA_MUTE_LABEL, muteLabel);
        unmuteLabel = stringExtra(intent, EXTRA_UNMUTE_LABEL, unmuteLabel);

        createNotificationChannel();
        goForeground(buildNotification());
        acquireLocks();
        return START_NOT_STICKY;
    }

    private static String stringExtra(Intent intent, String key, String fallback) {
        String value = intent.getStringExtra(key);
        return value == null || value.isEmpty() ? fallback : value;
    }

    /**
     * Called on every update, not only the first: the microphone type can be
     * gained later (the permission is granted the first time the mic is
     * opened, usually after the call started), and startForeground is how a
     * running service changes its types.
     */
    private void goForeground(Notification notification) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification);
            return;
        }
        int types = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK;
        // API 30 is both when the type exists and when the restriction it
        // lifts began. Only while the permission is granted: from Android 14
        // asking for the type without it throws.
        boolean withMic = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && hasMicPermission(this);
        if (withMic) types |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
        try {
            startForeground(NOTIFICATION_ID, notification, types);
        } catch (RuntimeException ex) {
            // The microphone type is a while-in-use one: asked for from the
            // background (a permission granted while the app was away), it
            // is refused. Keep the call itself alive; the next update made
            // with the app on screen adds it.
            if (!withMic) throw ex;
            Log.w(TAG, "microphone type refused; running as mediaPlayback only", ex);
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        }
    }

    static boolean hasMicPermission(Context context) {
        return ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }

    @SuppressLint("WakelockTimeout")
    private void acquireLocks() {
        // No timeout: the lock lives exactly as long as the call, and
        // onDestroy is where it goes.
        if (wakeLock == null) {
            PowerManager power = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (power != null) {
                wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "GoLive:call");
                wakeLock.setReferenceCounted(false);
                wakeLock.acquire();
            }
        }
        if (wifiLock == null) {
            WifiManager wifi = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wifi != null) {
                int mode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                    ? WifiManager.WIFI_MODE_FULL_LOW_LATENCY
                    : WifiManager.WIFI_MODE_FULL_HIGH_PERF;
                wifiLock = wifi.createWifiLock(mode, "GoLive:call");
                wifiLock.setReferenceCounted(false);
                wifiLock.acquire();
            }
        }
    }

    private void releaseLocks() {
        if (wakeLock != null) {
            if (wakeLock.isHeld()) wakeLock.release();
            wakeLock = null;
        }
        if (wifiLock != null) {
            if (wifiLock.isHeld()) wifiLock.release();
            wifiLock = null;
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Chamada em andamento", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Mostrada enquanto você está em uma sala ou chamada, para ela continuar com o app em segundo plano.");
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }

    private PendingIntent serviceIntent(String action, int requestCode) {
        Intent intent = new Intent(this, CallService.class).setAction(action);
        return PendingIntent.getService(this, requestCode, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private Notification buildNotification() {
        Intent activityIntent = new Intent(this, MainActivity.class);
        activityIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(this, 0, activityIntent, PendingIntent.FLAG_IMMUTABLE);
        PendingIntent leave = serviceIntent(ACTION_LEAVE, 1);
        PendingIntent toggleMic = serviceIntent(ACTION_TOGGLE_MIC, 2);

        Person caller = new Person.Builder().setName(title).setImportant(true).build();
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_golive)
            .setColor(ContextCompat.getColor(this, R.color.golive_brand))
            .setContentTitle(title)
            .setContentIntent(contentIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .addAction(0, micOn ? muteLabel : unmuteLabel, toggleMic)
            .setStyle(NotificationCompat.CallStyle.forOngoingCall(caller, leave));
        if (!text.isEmpty()) builder.setContentText(text);
        return builder.build();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Swiping the app away destroys the activity and its WebView, which
        // is the call. The notification must not outlive it.
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        releaseLocks();
        super.onDestroy();
    }
}

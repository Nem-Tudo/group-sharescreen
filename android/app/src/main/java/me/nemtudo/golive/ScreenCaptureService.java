package me.nemtudo.golive;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.util.Base64;
import android.util.Log;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;

/**
 * The whole native half of Android screen sharing, in one foreground
 * service: owns the {@link MediaProjection}, the {@link VirtualDisplay} that
 * mirrors the screen into it, and the {@link ImageReader} that pulls frames
 * off it — encoding each as a JPEG and handing it to
 * {@link ScreenCapturePlugin} over the static listener below.
 *
 * A real {@link Service}, not just code running in the activity, because
 * Android requires it: since Android 10, a MediaProjection may only be used
 * while a foreground service of type {@code mediaProjection} is running, and
 * Android 14 enforces this by throwing a SecurityException out of
 * {@link MediaProjectionManager#getMediaProjection} if that service was not
 * already started when it is called — which is why {@link #onStartCommand}
 * calls {@link #startForeground} before it does anything else.
 *
 * Same process as the plugin and the WebView (no {@code :remote} process, no
 * AIDL), so talking back to JS is a plain static callback rather than
 * cross-process IPC — see {@link #setFrameListener} / {@link #setStateListener}.
 */
public class ScreenCaptureService extends Service {

    public static final String EXTRA_RESULT_CODE = "resultCode";
    public static final String EXTRA_RESULT_DATA = "resultData";
    public static final String EXTRA_WIDTH = "width";
    public static final String EXTRA_HEIGHT = "height";
    public static final String EXTRA_DENSITY = "density";
    public static final String EXTRA_FPS = "fps";

    private static final String TAG = "GoLiveScreenCapture";
    private static final String CHANNEL_ID = "golive_screen_capture";
    private static final int NOTIFICATION_ID = 4821;

    public interface FrameListener {
        void onFrame(String base64Jpeg, int width, int height);
    }

    public interface StateListener {
        void onStopped();
    }

    // Static, not instance fields: the plugin sets these right before
    // starting the service (it cannot get a reference to the Service
    // instance any other way — startForegroundService() returns nothing),
    // and clears them once the JS side has torn the capture down.
    @Nullable
    private static volatile FrameListener frameListener;

    @Nullable
    private static volatile StateListener stateListener;

    public static void setFrameListener(@Nullable FrameListener listener) {
        frameListener = listener;
    }

    public static void setStateListener(@Nullable StateListener listener) {
        stateListener = listener;
    }

    private MediaProjection mediaProjection;
    private VirtualDisplay virtualDisplay;
    private ImageReader imageReader;
    private HandlerThread captureThread;
    private Handler captureHandler;
    private long minFrameIntervalMs = 1000L / 8L;
    private volatile long lastFrameAtMs = 0L;

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            stopSelf();
            return START_NOT_STICKY;
        }

        createNotificationChannel();
        // Must happen before getMediaProjection() below — see the class
        // doc comment. The type flag only exists from API 29; earlier
        // platforms have no such requirement to satisfy in the first place.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, buildNotification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
        } else {
            startForeground(NOTIFICATION_ID, buildNotification());
        }

        int resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0);
        Intent resultData = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            ? intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent.class)
            : intent.getParcelableExtra(EXTRA_RESULT_DATA);
        int width = intent.getIntExtra(EXTRA_WIDTH, 1280);
        int height = intent.getIntExtra(EXTRA_HEIGHT, 720);
        int density = intent.getIntExtra(EXTRA_DENSITY, 160);
        int fps = intent.getIntExtra(EXTRA_FPS, 8);
        minFrameIntervalMs = 1000L / Math.max(1, fps);

        if (resultData == null) {
            Log.w(TAG, "onStartCommand sem resultData; encerrando.");
            stopSelf();
            return START_NOT_STICKY;
        }

        MediaProjectionManager manager = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        if (manager == null) {
            stopSelf();
            return START_NOT_STICKY;
        }

        try {
            mediaProjection = manager.getMediaProjection(resultCode, resultData);
        } catch (SecurityException ex) {
            Log.e(TAG, "getMediaProjection recusado", ex);
            stopSelf();
            return START_NOT_STICKY;
        }
        if (mediaProjection == null) {
            stopSelf();
            return START_NOT_STICKY;
        }

        captureThread = new HandlerThread("golive-screen-capture");
        captureThread.start();
        captureHandler = new Handler(captureThread.getLooper());

        mediaProjection.registerCallback(
            new MediaProjection.Callback() {
                @Override
                public void onStop() {
                    // Fired by the system's own "Stop sharing" affordance,
                    // which every MediaProjection session gets regardless of
                    // this app's own notification — the user can end the
                    // share from there without ever touching GoLive's UI.
                    notifyStoppedAndTearDown();
                }
            },
            captureHandler
        );

        startCapture(width, height, density);
        return START_NOT_STICKY;
    }

    private void startCapture(int width, int height, int density) {
        imageReader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2);
        imageReader.setOnImageAvailableListener(
            reader -> {
                Image image;
                try {
                    image = reader.acquireLatestImage();
                } catch (IllegalStateException ex) {
                    // More images acquired than the reader's maxImages without
                    // closing the previous one — should not happen given the
                    // early-return below always closes what it acquires, but
                    // an ImageReader bug here must not crash the whole service.
                    return;
                }
                if (image == null) return;

                long now = System.currentTimeMillis();
                if (now - lastFrameAtMs < minFrameIntervalMs) {
                    image.close();
                    return;
                }
                lastFrameAtMs = now;
                try {
                    processImage(image, width, height);
                } catch (Exception ex) {
                    Log.w(TAG, "Falha ao processar frame", ex);
                } finally {
                    image.close();
                }
            },
            captureHandler
        );

        virtualDisplay = mediaProjection.createVirtualDisplay(
            "GoLiveScreenCapture",
            width,
            height,
            density,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            imageReader.getSurface(),
            null,
            captureHandler
        );
    }

    // The canonical RGBA_8888-ImageReader-to-Bitmap conversion: each row can
    // be padded to a stride wider than width * pixelStride, so the bitmap is
    // built at the padded width and cropped back down rather than assuming
    // rowStride == width * 4.
    private void processImage(Image image, int width, int height) {
        Image.Plane[] planes = image.getPlanes();
        ByteBuffer buffer = planes[0].getBuffer();
        int pixelStride = planes[0].getPixelStride();
        int rowStride = planes[0].getRowStride();
        int rowPadding = rowStride - pixelStride * width;
        int paddedWidth = width + rowPadding / pixelStride;

        Bitmap bitmap = Bitmap.createBitmap(paddedWidth, height, Bitmap.Config.ARGB_8888);
        bitmap.copyPixelsFromBuffer(buffer);
        if (rowPadding != 0) {
            Bitmap cropped = Bitmap.createBitmap(bitmap, 0, 0, width, height);
            bitmap.recycle();
            bitmap = cropped;
        }

        ByteArrayOutputStream out = new ByteArrayOutputStream();
        // 60: readable for documents/UI (what a screen share overwhelmingly
        // is) at a size that does not choke the plugin bridge every frame —
        // this is the whole trade-off lib/androidScreenCapture.ts's own
        // comment describes.
        bitmap.compress(Bitmap.CompressFormat.JPEG, 60, out);
        bitmap.recycle();

        String base64 = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
        FrameListener listener = frameListener;
        if (listener != null) {
            listener.onFrame(base64, width, height);
        }
    }

    private void notifyStoppedAndTearDown() {
        StateListener listener = stateListener;
        if (listener != null) {
            listener.onStopped();
        }
        stopSelf();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Compartilhamento de tela",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Notificação contínua enquanto sua tela está sendo compartilhada em uma sala do GoLive.");
        manager.createNotificationChannel(channel);
    }

    private Notification buildNotification() {
        Intent activityIntent = new Intent(this, MainActivity.class);
        activityIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
            this,
            0,
            activityIntent,
            PendingIntent.FLAG_IMMUTABLE
        );

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("GoLive")
            .setContentText("Sua tela está sendo compartilhada")
            // The app's own launcher icon. Not a proper monochrome
            // status-bar glyph — swap for one before shipping to Play, see
            // android/README.md.
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(contentIntent)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build();
    }

    @Override
    public void onDestroy() {
        if (virtualDisplay != null) {
            virtualDisplay.release();
            virtualDisplay = null;
        }
        if (imageReader != null) {
            imageReader.close();
            imageReader = null;
        }
        if (mediaProjection != null) {
            mediaProjection.stop();
            mediaProjection = null;
        }
        if (captureThread != null) {
            captureThread.quitSafely();
            captureThread = null;
        }
        super.onDestroy();
    }
}

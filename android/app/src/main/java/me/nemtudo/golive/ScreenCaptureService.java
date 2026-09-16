package me.nemtudo.golive;

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
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioPlaybackCaptureConfiguration;
import android.media.AudioRecord;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Process;
import android.util.Base64;
import android.util.Log;
import androidx.annotation.Nullable;
import androidx.annotation.RequiresApi;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
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
    public static final String EXTRA_AUDIO = "audio";

    /** What {@link #startAudioCapture} produces, and what
     *  lib/pcmAudioTrack.ts expects on the other side of the bridge:
     *  interleaved 16-bit little-endian PCM at 48 kHz. Fixed rather than
     *  negotiated because the web end is fixed too — the AudioWorklet that
     *  buffers this is shared with the desktop helper, which sends the same
     *  format. */
    private static final int AUDIO_SAMPLE_RATE = 48000;
    private static final int AUDIO_CHANNELS = 2;
    private static final int AUDIO_BYTES_PER_SAMPLE = 2;

    /** How much audio goes into one bridge message, in frames. 20ms is a
     *  compromise between two costs that pull opposite ways: every chunk is
     *  a separate notifyListeners() hop onto the WebView's main thread (so
     *  fewer, bigger chunks are cheaper), and a chunk cannot be played until
     *  all of it has arrived (so smaller chunks reach the ear sooner). At
     *  20ms this is 50 messages a second carrying ~5KB of base64 each,
     *  against the 15 much larger JPEG frames already sharing that thread. */
    private static final int AUDIO_CHUNK_FRAMES = AUDIO_SAMPLE_RATE / 50;

    private static final String TAG = "GoLiveScreenCapture";
    private static final String CHANNEL_ID = "golive_screen_capture";
    private static final int NOTIFICATION_ID = 4821;

    public interface FrameListener {
        void onFrame(String base64Jpeg, int width, int height);
    }

    public interface StateListener {
        void onStopped();
    }

    public interface AudioListener {
        void onAudio(String base64Pcm);
    }

    // Static, not instance fields: the plugin sets these right before
    // starting the service (it cannot get a reference to the Service
    // instance any other way — startForegroundService() returns nothing),
    // and clears them once the JS side has torn the capture down.
    @Nullable
    private static volatile FrameListener frameListener;

    @Nullable
    private static volatile StateListener stateListener;

    @Nullable
    private static volatile AudioListener audioListener;

    public static void setFrameListener(@Nullable FrameListener listener) {
        frameListener = listener;
    }

    public static void setStateListener(@Nullable StateListener listener) {
        stateListener = listener;
    }

    public static void setAudioListener(@Nullable AudioListener listener) {
        audioListener = listener;
    }

    private MediaProjection mediaProjection;
    private VirtualDisplay virtualDisplay;
    private ImageReader imageReader;
    private HandlerThread captureThread;
    private Handler captureHandler;
    private long minFrameIntervalMs = 1000L / 8L;
    private volatile long lastFrameAtMs = 0L;

    @Nullable
    private AudioRecord audioRecord;
    @Nullable
    private Thread audioThread;
    private volatile boolean audioRunning = false;

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

        // Read before startForeground because it decides which foreground
        // service types this has to run as — see below. Reading an extra is
        // not a MediaProjection call, so it does not fall foul of the
        // ordering the class doc describes.
        boolean wantsAudio = intent.getBooleanExtra(EXTRA_AUDIO, false) && canCaptureSystemAudio(this);

        createNotificationChannel();
        // Must happen before getMediaProjection() below — see the class
        // doc comment. The type flag only exists from API 29; earlier
        // platforms have no such requirement to satisfy in the first place.
        //
        // The microphone type goes on alongside mediaProjection whenever
        // audio is wanted and the platform is Android 11 or newer. Playback
        // capture is not the microphone, but it runs through AudioRecord all
        // the same, and from Android 11 an AudioRecord owned by a process
        // that is not in the foreground is fed silence unless a foreground
        // service of that type is running.
        // Declaring it only when audio was actually asked for keeps an
        // ordinary silent share off a permission-shaped service type it has
        // no use for — and the type is only legal while RECORD_AUDIO is
        // granted, which is precisely what canCaptureSystemAudio has just
        // checked.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            int types = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION;
            // The microphone type is API 30, and so is the restriction it
            // exists to satisfy: Android 10 lets a foreground service record
            // without it. Adding the bit there would mean passing a type the
            // platform does not know.
            if (wantsAudio && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                types |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
            }
            startForeground(NOTIFICATION_ID, buildNotification(), types);
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
        // The SDK check is redundant against wantsAudio (canCaptureSystemAudio
        // already answered no below Q) and stated anyway, because lint reads
        // this call site rather than that method's contract.
        if (wantsAudio && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startAudioCapture();
        return START_NOT_STICKY;
    }

    /**
     * Whether this device can hand over what other apps are playing.
     *
     * Two hard requirements, neither of which holds everywhere:
     * AudioPlaybackCapture is API 29, and it is gated on RECORD_AUDIO like
     * any other AudioRecord. The plugin asks for that permission before
     * starting this service, but the user is free to say no — and a share
     * that failed outright because the sound could not be captured would be
     * a far worse outcome than a silent one, so every caller treats false
     * here as "carry on without audio".
     */
    static boolean canCaptureSystemAudio(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return false;
        return ContextCompat.checkSelfPermission(context, android.Manifest.permission.RECORD_AUDIO)
            == PackageManager.PERMISSION_GRANTED;
    }

    /**
     * Starts capturing what other apps are playing and streams it to JS as
     * base64 PCM, or gives up quietly and leaves the share silent.
     *
     * The room's own audio is deliberately left out of it, by excluding this
     * app's own uid. Without that, everything GoLive is playing — every
     * other participant's voice, and the audio of any share being watched —
     * would be captured and sent straight back to the room, so everyone
     * hears themselves a moment late. That is the same exclusion the desktop
     * app's WASAPI helper makes for the same reason (see
     * lib/desktopSystemAudio.ts), and it has the same consequence: audio
     * played by GoLive itself is never part of the share.
     *
     * What this cannot do anything about: an app may refuse to be captured
     * at all, by declaring a restrictive allowAudioPlaybackCapture policy.
     * Most paid media apps do. Those contribute silence, with no error
     * anywhere — there is no API that reports it.
     */
    @RequiresApi(Build.VERSION_CODES.Q)
    private void startAudioCapture() {
        if (mediaProjection == null) return;

        AudioPlaybackCaptureConfiguration config;
        try {
            config = new AudioPlaybackCaptureConfiguration.Builder(mediaProjection)
                .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                .addMatchingUsage(AudioAttributes.USAGE_GAME)
                .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
                .excludeUid(Process.myUid())
                .build();
        } catch (Exception ex) {
            Log.w(TAG, "Configuracao de captura de audio recusada", ex);
            return;
        }

        // Stereo first, mono as a fallback. Screen audio is music, a game or
        // a video far more often than it is speech, so the stereo image is
        // worth asking for — but a device whose remote-submix path only
        // offers mono should still produce sound rather than nothing, and
        // readLoop upmixes so the web end never has to know which it got.
        audioRecord = buildRecord(config, AudioFormat.CHANNEL_IN_STEREO);
        boolean stereo = audioRecord != null;
        if (!stereo) audioRecord = buildRecord(config, AudioFormat.CHANNEL_IN_MONO);
        if (audioRecord == null) {
            Log.w(TAG, "Nao foi possivel iniciar a captura de audio");
            return;
        }

        try {
            audioRecord.startRecording();
        } catch (IllegalStateException ex) {
            Log.w(TAG, "startRecording recusado", ex);
            audioRecord.release();
            audioRecord = null;
            return;
        }

        audioRunning = true;
        final boolean sourceIsStereo = stereo;
        // Its own thread, not captureHandler's: that one is already busy
        // turning screen frames into JPEGs, and an AudioRecord read that
        // waits behind a compress is an AudioRecord whose internal buffer
        // overruns. A dropped audio frame is audible in a way a dropped
        // video frame is not.
        audioThread = new Thread(() -> readLoop(sourceIsStereo), "golive-screen-audio");
        audioThread.start();
    }

    // RECORD_AUDIO is checked, just not on this frame: canCaptureSystemAudio
    // is what gates every path that reaches here, and it runs in
    // onStartCommand before the service commits to capturing audio at all.
    // The construction below is wrapped in a catch that treats a refusal as
    // "no audio", so a permission revoked between that check and this call
    // costs the share its sound and nothing else.
    @SuppressLint("MissingPermission")
    @Nullable
    @RequiresApi(Build.VERSION_CODES.Q)
    private AudioRecord buildRecord(AudioPlaybackCaptureConfiguration config, int channelMask) {
        AudioFormat format = new AudioFormat.Builder()
            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .setSampleRate(AUDIO_SAMPLE_RATE)
            .setChannelMask(channelMask)
            .build();

        int channels = channelMask == AudioFormat.CHANNEL_IN_STEREO ? 2 : 1;
        int minBuffer = AudioRecord.getMinBufferSize(
            AUDIO_SAMPLE_RATE,
            channelMask,
            AudioFormat.ENCODING_PCM_16BIT
        );
        if (minBuffer <= 0) return null;
        // Four chunks of headroom over whatever the platform asks for, so a
        // read thread that gets descheduled for a moment does not lose audio.
        int bufferBytes = Math.max(minBuffer, AUDIO_CHUNK_FRAMES * channels * AUDIO_BYTES_PER_SAMPLE * 4);

        AudioRecord record;
        try {
            record = new AudioRecord.Builder()
                .setAudioFormat(format)
                .setBufferSizeInBytes(bufferBytes)
                .setAudioPlaybackCaptureConfig(config)
                .build();
        } catch (Exception ex) {
            Log.w(TAG, "AudioRecord recusado para " + channels + " canal(is)", ex);
            return null;
        }
        if (record.getState() != AudioRecord.STATE_INITIALIZED) {
            record.release();
            return null;
        }
        return record;
    }

    private void readLoop(boolean sourceIsStereo) {
        int sourceChannels = sourceIsStereo ? 2 : 1;
        byte[] buffer = new byte[AUDIO_CHUNK_FRAMES * sourceChannels * AUDIO_BYTES_PER_SAMPLE];
        // Only allocated when it is actually needed: with a stereo source the
        // bytes go out exactly as they were read.
        byte[] upmixed = sourceIsStereo ? null : new byte[AUDIO_CHUNK_FRAMES * 2 * AUDIO_BYTES_PER_SAMPLE];

        while (audioRunning) {
            AudioRecord record = audioRecord;
            if (record == null) break;
            int read = record.read(buffer, 0, buffer.length);
            if (read <= 0) {
                // A negative result is ERROR_INVALID_OPERATION and friends:
                // the record was stopped underneath this thread, which is
                // the ordinary way this loop ends. A zero-length read is
                // simply nothing worth sending.
                if (read < 0) break;
                continue;
            }

            byte[] payload;
            int length;
            if (sourceIsStereo) {
                payload = buffer;
                length = read;
            } else {
                // Each mono frame becomes an identical pair, so the web end
                // always receives the interleaved stereo it expects.
                int frames = read / AUDIO_BYTES_PER_SAMPLE;
                for (int i = 0; i < frames; i++) {
                    byte lo = buffer[i * 2];
                    byte hi = buffer[i * 2 + 1];
                    upmixed[i * 4] = lo;
                    upmixed[i * 4 + 1] = hi;
                    upmixed[i * 4 + 2] = lo;
                    upmixed[i * 4 + 3] = hi;
                }
                payload = upmixed;
                length = frames * 4;
            }

            AudioListener listener = audioListener;
            if (listener == null) continue;
            listener.onAudio(Base64.encodeToString(payload, 0, length, Base64.NO_WRAP));
        }
    }

    private void stopAudioCapture() {
        audioRunning = false;
        Thread thread = audioThread;
        audioThread = null;
        AudioRecord record = audioRecord;
        audioRecord = null;
        if (record != null) {
            try {
                record.stop();
            } catch (IllegalStateException ignored) {
                // Already stopped; the release below is what actually matters.
            }
            record.release();
        }
        if (thread != null) {
            try {
                // Bounded rather than an open-ended join: this runs on the
                // main thread from onDestroy, and a read that is somehow not
                // returning must not take the UI down with it. The loop's
                // own flag plus the released record end it either way.
                thread.join(200);
            } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
            }
        }
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
        // Before the projection is stopped: the AudioRecord was built from
        // it, and reading one whose projection has already gone away is what
        // turns a clean stop into a native crash.
        stopAudioCapture();
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

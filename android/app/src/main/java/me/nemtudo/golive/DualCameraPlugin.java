package me.nemtudo.golive;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Context;
import android.content.pm.PackageManager;
import android.graphics.ImageFormat;
import android.graphics.Rect;
import android.graphics.YuvImage;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraCaptureSession;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraDevice;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CaptureRequest;
import android.hardware.camera2.params.OutputConfiguration;
import android.hardware.camera2.params.SessionConfiguration;
import android.media.Image;
import android.media.ImageReader;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.util.Base64;
import android.util.Size;
import android.view.Surface;
import android.view.WindowManager;
import androidx.annotation.NonNull;
import androidx.annotation.RequiresApi;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.concurrent.Executor;

/**
 * Front and rear cameras at the same time — see lib/androidDualCamera.ts.
 *
 * The WebView cannot do this: Chromium keeps one camera open at a time, and a
 * second getUserMedia fails with "NotReadableError: Could not start video
 * source" whatever the hardware could do. So while both are wanted, both are
 * opened here instead, through Camera2's concurrent-camera support (Android
 * 11+, and only on devices that list a front+back pair in
 * {@link CameraManager#getConcurrentCameraIds()}).
 *
 * Frames travel the same way ScreenCaptureService's do: YUV from an
 * ImageReader, compressed to JPEG, base64 over the plugin bridge, drawn onto a
 * canvas on the JS side. Each frame carries which lens it came from and how
 * far it has to be rotated to be upright — the sensor's orientation is not the
 * screen's, and rotating a canvas is cheaper than rotating pixels here.
 *
 * Runs with the activity, not a foreground service. Picture-in-picture keeps
 * the activity visible and the cameras open; when Android does take a camera
 * away (the app goes fully to the background, another app claims it), the
 * device callbacks below report it as a "stopped" state change.
 */
@CapacitorPlugin(name = "DualCamera")
public class DualCameraPlugin extends Plugin {

    private static final int JPEG_QUALITY = 60;

    private HandlerThread thread;
    private Handler handler;
    private final List<Lens> lenses = new ArrayList<>();
    private volatile boolean running = false;

    /** One open camera: its device, session, reader and pacing. */
    private final class Lens {
        final String id;
        final String name; // "front" | "back"
        final int sensorOrientation;
        final boolean front;
        CameraDevice device;
        CameraCaptureSession session;
        ImageReader reader;
        long lastFrameAt = 0;

        Lens(String id, String name, int sensorOrientation, boolean front) {
            this.id = id;
            this.name = name;
            this.sensorOrientation = sensorOrientation;
            this.front = front;
        }
    }

    /**
     * Whether this device can open a front and a rear camera together. The
     * button is only offered where this says yes.
     */
    @PluginMethod
    public void isSupported(PluginCall call) {
        JSObject result = new JSObject();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            result.put("supported", false);
            result.put("reason", "android-too-old");
            call.resolve(result);
            return;
        }
        String[] pair = findPair();
        result.put("supported", pair != null);
        if (pair == null) result.put("reason", "no-concurrent-pair");
        call.resolve(result);
    }

    /** [frontId, backId] from a concurrent combination, or null. */
    private String[] findPair() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return null;
        CameraManager manager = cameraManager();
        if (manager == null) return null;
        try {
            for (Set<String> combo : manager.getConcurrentCameraIds()) {
                String frontId = null;
                String backId = null;
                for (String id : combo) {
                    Integer facing = manager.getCameraCharacteristics(id).get(CameraCharacteristics.LENS_FACING);
                    if (facing == null) continue;
                    if (facing == CameraCharacteristics.LENS_FACING_FRONT && frontId == null) frontId = id;
                    if (facing == CameraCharacteristics.LENS_FACING_BACK && backId == null) backId = id;
                }
                if (frontId != null && backId != null) return new String[] { frontId, backId };
            }
        } catch (Exception ignored) {
            // A device whose camera service misbehaves here cannot be trusted
            // with two cameras either.
        }
        return null;
    }

    private CameraManager cameraManager() {
        return (CameraManager) getContext().getSystemService(Context.CAMERA_SERVICE);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            call.reject("Android 11 ou mais novo é necessário.", "unsupported");
            return;
        }
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            call.reject("Sem permissão de câmera.", "permission");
            return;
        }
        String[] pair = findPair();
        if (pair == null) {
            call.reject("Este aparelho não abre as duas câmeras juntas.", "unsupported");
            return;
        }
        stopAll();
        int width = call.getInt("width", 640);
        int height = call.getInt("height", 480);
        int fps = Math.max(1, Math.min(call.getInt("fps", 15), 30));
        startApi30(call, pair, width, height, fps);
    }

    @RequiresApi(api = Build.VERSION_CODES.R)
    @SuppressLint("MissingPermission")
    private void startApi30(PluginCall call, String[] pair, int width, int height, int fps) {
        CameraManager manager = cameraManager();
        thread = new HandlerThread("golive-dual-camera");
        thread.start();
        handler = new Handler(thread.getLooper());
        running = true;
        final long frameIntervalMs = 1000L / fps;
        final int[] opened = { 0 };
        final boolean[] answered = { false };

        for (int i = 0; i < 2; i++) {
            final String id = pair[i];
            final boolean front = i == 0;
            int sensor;
            Size size;
            try {
                CameraCharacteristics chars = manager.getCameraCharacteristics(id);
                Integer orientation = chars.get(CameraCharacteristics.SENSOR_ORIENTATION);
                sensor = orientation == null ? 0 : orientation;
                size = pickSize(chars, width, height);
            } catch (CameraAccessException ex) {
                fail(call, answered, "Não foi possível ler a câmera: " + ex.getMessage());
                return;
            }
            final Lens lens = new Lens(id, front ? "front" : "back", sensor, front);
            lens.reader = ImageReader.newInstance(size.getWidth(), size.getHeight(), ImageFormat.YUV_420_888, 2);
            lens.reader.setOnImageAvailableListener(reader -> {
                Image image = reader.acquireLatestImage();
                if (image == null) return;
                try {
                    long now = System.currentTimeMillis();
                    if (!running || now - lens.lastFrameAt < frameIntervalMs) return;
                    lens.lastFrameAt = now;
                    sendFrame(lens, image);
                } finally {
                    image.close();
                }
            }, handler);
            lenses.add(lens);

            try {
                manager.openCamera(id, new CameraDevice.StateCallback() {
                    @Override
                    public void onOpened(@NonNull CameraDevice device) {
                        if (!running) {
                            device.close();
                            return;
                        }
                        lens.device = device;
                        createSession(lens, () -> {
                            opened[0]++;
                            if (opened[0] == 2 && !answered[0]) {
                                answered[0] = true;
                                call.resolve();
                            }
                        }, reason -> fail(call, answered, reason));
                    }

                    @Override
                    public void onDisconnected(@NonNull CameraDevice device) {
                        device.close();
                        lens.device = null;
                        ended(call, answered, "A câmera foi desconectada pelo sistema.");
                    }

                    @Override
                    public void onError(@NonNull CameraDevice device, int error) {
                        device.close();
                        lens.device = null;
                        ended(call, answered, "Erro da câmera (" + error + ").");
                    }
                }, handler);
            } catch (Exception ex) {
                fail(call, answered, "Não foi possível abrir a câmera: " + ex.getMessage());
                return;
            }
        }
    }

    private interface Done { void run(); }
    private interface Failed { void run(String reason); }

    @RequiresApi(api = Build.VERSION_CODES.R)
    private void createSession(Lens lens, Done done, Failed failed) {
        try {
            Executor executor = runnable -> handler.post(runnable);
            List<OutputConfiguration> outputs = Collections.singletonList(new OutputConfiguration(lens.reader.getSurface()));
            SessionConfiguration config = new SessionConfiguration(
                SessionConfiguration.SESSION_REGULAR,
                outputs,
                executor,
                new CameraCaptureSession.StateCallback() {
                    @Override
                    public void onConfigured(@NonNull CameraCaptureSession session) {
                        lens.session = session;
                        try {
                            CaptureRequest.Builder request = lens.device.createCaptureRequest(CameraDevice.TEMPLATE_RECORD);
                            request.addTarget(lens.reader.getSurface());
                            request.set(CaptureRequest.CONTROL_MODE, CaptureRequest.CONTROL_MODE_AUTO);
                            session.setRepeatingRequest(request.build(), null, handler);
                            done.run();
                        } catch (Exception ex) {
                            failed.run("Não foi possível iniciar a captura: " + ex.getMessage());
                        }
                    }

                    @Override
                    public void onConfigureFailed(@NonNull CameraCaptureSession session) {
                        failed.run("O aparelho recusou a configuração das duas câmeras.");
                    }
                }
            );
            lens.device.createCaptureSession(config);
        } catch (Exception ex) {
            failed.run("Não foi possível configurar a câmera: " + ex.getMessage());
        }
    }

    /** The largest YUV size that fits inside what was asked for (concurrent
     *  streams are only guaranteed up to 720p, so the caller asks small). */
    private Size pickSize(CameraCharacteristics chars, int maxWidth, int maxHeight) {
        android.hardware.camera2.params.StreamConfigurationMap map =
            chars.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP);
        Size best = new Size(640, 480);
        if (map == null) return best;
        Size[] sizes = map.getOutputSizes(ImageFormat.YUV_420_888);
        if (sizes == null) return best;
        long bestArea = 0;
        int longMax = Math.max(maxWidth, maxHeight);
        int shortMax = Math.min(maxWidth, maxHeight);
        for (Size s : sizes) {
            int longSide = Math.max(s.getWidth(), s.getHeight());
            int shortSide = Math.min(s.getWidth(), s.getHeight());
            if (longSide > longMax || shortSide > shortMax) continue;
            long area = (long) s.getWidth() * s.getHeight();
            if (area > bestArea) {
                bestArea = area;
                best = s;
            }
        }
        return best;
    }

    private void sendFrame(Lens lens, Image image) {
        int width = image.getWidth();
        int height = image.getHeight();
        byte[] nv21 = toNv21(image);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new YuvImage(nv21, ImageFormat.NV21, width, height, null).compressToJpeg(new Rect(0, 0, width, height), JPEG_QUALITY, out);
        JSObject data = new JSObject();
        data.put("lens", lens.name);
        data.put("data", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
        data.put("width", width);
        data.put("height", height);
        data.put("rotation", rotationFor(lens));
        notifyListeners("frame", data);
    }

    /** Degrees clockwise to turn the frame upright for how the phone is held. */
    private int rotationFor(Lens lens) {
        int degrees = 0;
        WindowManager wm = (WindowManager) getContext().getSystemService(Context.WINDOW_SERVICE);
        if (wm != null) {
            switch (wm.getDefaultDisplay().getRotation()) {
                case Surface.ROTATION_90: degrees = 90; break;
                case Surface.ROTATION_180: degrees = 180; break;
                case Surface.ROTATION_270: degrees = 270; break;
                default: degrees = 0;
            }
        }
        return lens.front
            ? (lens.sensorOrientation + degrees) % 360
            : (lens.sensorOrientation - degrees + 360) % 360;
    }

    /** YUV_420_888 (any strides) into NV21, which YuvImage understands. */
    private static byte[] toNv21(Image image) {
        int width = image.getWidth();
        int height = image.getHeight();
        byte[] out = new byte[width * height * 3 / 2];
        Image.Plane[] planes = image.getPlanes();

        ByteBuffer y = planes[0].getBuffer();
        int yRowStride = planes[0].getRowStride();
        int pos = 0;
        for (int row = 0; row < height; row++) {
            y.position(row * yRowStride);
            y.get(out, pos, width);
            pos += width;
        }

        ByteBuffer u = planes[1].getBuffer();
        ByteBuffer v = planes[2].getBuffer();
        int uvRowStride = planes[1].getRowStride();
        int uvPixelStride = planes[1].getPixelStride();
        for (int row = 0; row < height / 2; row++) {
            for (int col = 0; col < width / 2; col++) {
                int index = row * uvRowStride + col * uvPixelStride;
                out[pos++] = v.get(index);
                out[pos++] = u.get(index);
            }
        }
        return out;
    }

    private void fail(PluginCall call, boolean[] answered, String reason) {
        stopAll();
        if (!answered[0]) {
            answered[0] = true;
            call.reject(reason, "failed");
        }
    }

    /** A camera went away after start() had answered: tell JS it is over. */
    private void ended(PluginCall call, boolean[] answered, String reason) {
        if (!answered[0]) {
            fail(call, answered, reason);
            return;
        }
        if (!running) return;
        stopAll();
        JSObject data = new JSObject();
        data.put("state", "stopped");
        data.put("reason", reason);
        notifyListeners("stateChange", data);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopAll();
        call.resolve();
    }

    private synchronized void stopAll() {
        running = false;
        for (Lens lens : lenses) {
            try {
                if (lens.session != null) lens.session.close();
            } catch (Exception ignored) {}
            try {
                if (lens.device != null) lens.device.close();
            } catch (Exception ignored) {}
            try {
                if (lens.reader != null) lens.reader.close();
            } catch (Exception ignored) {}
        }
        lenses.clear();
        if (thread != null) {
            thread.quitSafely();
            thread = null;
            handler = null;
        }
    }

    @Override
    protected void handleOnDestroy() {
        stopAll();
        super.handleOnDestroy();
    }
}

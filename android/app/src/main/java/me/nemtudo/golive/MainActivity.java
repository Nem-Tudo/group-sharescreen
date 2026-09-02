package me.nemtudo.golive;

import android.content.res.Configuration;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    // Must run before super.onCreate() — that is where BridgeActivity
    // finalizes the plugin list it was given (see its own load()), so a
    // plugin registered afterwards would simply never be found by JS's
    // registerPlugin("ScreenCapture") call in lib/androidScreenCapture.ts.
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ScreenCapturePlugin.class);
        registerPlugin(PictureInPicturePlugin.class);
        super.onCreate(savedInstanceState);
    }

    /**
     * Android tells the *activity*, not the plugin, when the window enters or
     * leaves picture-in-picture — including when the user closes the floating
     * window or taps it to come back, which nothing on the JS side would
     * otherwise hear about. Forwarded so the web app can drop its stripped
     * single-tile layout again (see the data-pip rules in app/globals.css).
     */
    @Override
    public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode, Configuration newConfig) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
        PictureInPicturePlugin.notifyModeChanged(isInPictureInPictureMode);
    }
}

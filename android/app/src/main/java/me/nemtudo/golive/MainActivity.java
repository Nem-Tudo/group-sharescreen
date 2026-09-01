package me.nemtudo.golive;

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
        super.onCreate(savedInstanceState);
    }
}

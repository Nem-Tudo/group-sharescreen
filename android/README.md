# GoLive Android (Capacitor)

Same idea as `electron/`: a **shell around the deployed site**, not a second
copy of it. `capacitor.config.ts` (repo root) points the WebView straight at
`https://golive.nemtudo.me`, and the entire UI — every component, all the
WebRTC — comes from there unchanged. Bundling the Next build into the APK
instead would buy nothing: this is a real-time app that is useless offline
anyway, and the site has server-side API routes (`/api/giphy`, `/api/umami`)
a static export cannot serve. See `capacitor.config.ts`'s own comment, which
mirrors `electron/main.ts`'s.

## What actually needed code, and what didn't

**Camera and mic need nothing here at all.** Capacitor's own WebView already
turns a `getUserMedia()` call into Android's runtime permission dialogs — see
`app/src/main/AndroidManifest.xml`'s `CAMERA` / `RECORD_AUDIO` /
`MODIFY_AUDIO_SETTINGS` entries, which is the only part of that story this
project had to add.

**Screen sharing needed a real native plugin.** `getDisplayMedia()` is not
implemented by Chromium on Android in *any* embedding, WebView or the Chrome
app itself; mobile Chrome always rejects it, which is why
`lib/useRoomMedia.ts`'s `getScreenShareMode()` already falls back to the
camera for "compartilhar tela" on every ordinary mobile browser. This shell
does better: `ScreenCapturePlugin.java` + `ScreenCaptureService.java` capture
the screen with Android's `MediaProjection` API and hand frames to
`lib/androidScreenCapture.ts`, which draws them onto a `<canvas>` and returns
`canvas.captureStream()` — an ordinary `MediaStream` that every call site
above it (quality presets, peer connections, the "ended" listener) already
knew how to handle without a single Android-specific branch beyond the one in
`useRoomMedia.ts` that picks this path over `getDisplayMedia`. See "Real
screen sharing, and its trade-offs" below for how it works and its limits.

**OAuth needed a bridge**, because Google/Discord refuse to authenticate
inside an embedded WebView (Google returns `disallowed_useragent` outright).
`lib/capacitorBridge.ts` is the Capacitor counterpart of
`electron/preload.ts` + `electron/main.ts`'s OAuth/deep-link handling: it
fills in `window.golive` with the exact same `DesktopBridge` contract
`lib/desktop.ts` defines, so `startOAuthLogin` (`lib/oauthApi.ts`),
`OpenInAppBanner`, and `UpdateAppButton` all work unmodified — they already
branch on "does a golive bridge exist", never on which shell provided it.

OAuth needed no custom native code — only two official Capacitor plugins:

- **`@capacitor/browser`** opens the OAuth start URL in a Chrome Custom Tab
  (Google's recommended "real browser" context for login, and not subject to
  the WebView rejection above).
- **`@capacitor/app`** delivers the `golive://` deep link back
  (`appUrlOpen`/`getLaunchUrl`) when the provider redirects to it, and
  supplies the app version for `window.golive.appVersion`.

Screen sharing is the one feature that *did* need a custom native plugin —
there is no official Capacitor API for MediaProjection, because there is
nothing in the web platform for it to expose.

## Real screen sharing, and its trade-offs

```
ScreenCapturePlugin.start()
  └─> MediaProjectionManager.createScreenCaptureIntent()  (system consent dialog)
        └─> ScreenCaptureService started as a foreground service
              (type "mediaProjection" — required from Android 14, see the
              service's own doc comment for why startForeground() has to run
              before getMediaProjection())
              └─> VirtualDisplay mirrors the screen into an ImageReader
                    └─> each frame: RGBA_8888 → Bitmap → JPEG → base64
                          └─> ScreenCapturePlugin.notifyListeners("frame", …)
                                └─> lib/androidScreenCapture.ts decodes it and
                                    draws it onto a <canvas>
                                      └─> canvas.captureStream() — a real
                                          MediaStreamTrack, added to the room's
                                          peer connections exactly like any
                                          other screen share
```

**Why a JSON-bridge JPEG stream and not something more "native"?** The
alternative — a local MJPEG-over-HTTP server into an `<img>` tag, or a second,
fully native WebRTC stack running alongside the WebView's own — would perform
better, but each adds a category of thing that has to be gotten right with no
way to compile-check or device-test it as part of this change: a hand-rolled
socket server (plus a `network_security_config.xml` carve-out for it), or an
entirely separate signaling/SDP implementation parallel to the one this app
already has in `useRoomMedia.ts`. The plugin bridge is the boring, verifiable
choice — every method on it is standard `@CapacitorPlugin` machinery, checked
against the actual `@capacitor/android` sources in `node_modules` rather than
memory. `lib/androidScreenCapture.ts`'s own comment states the resulting
ceiling plainly: `MAX_CAPTURE_WIDTH`/`HEIGHT`/`FPS` cap the picker's own
resolution/fps dials (which go up to 1440p/120fps, sized for a real
hardware-encoded `getDisplayMedia` stream) down to 1280×720 at 15fps
regardless of what a user picks. That reads documents, chats and slides just
fine and looks soft on fast motion — the honest trade for the simpler
implementation.

**This was not run on a device or emulator as part of this change** — there
is no Android SDK/JDK in the environment that wrote it, only the Capacitor
plugin API verified line-by-line against `node_modules/@capacitor/android`'s
actual Java sources. Build it in Android Studio and test the real flow before
trusting it: tap "compartilhar tela" in a room, grant the system's screen-
capture prompt, confirm the ongoing-share notification appears and that the
video actually reaches another viewer. `adb logcat -s GoLiveScreenCapture` is
where `ScreenCaptureService` logs anything that goes wrong on the native side.
Likely first failure modes, in order of how probable they are:

- A `SecurityException` out of `getMediaProjection()` — the foreground
  service didn't actually start in time, or its declared
  `foregroundServiceType` doesn't match what `startForeground()` passed. Both
  live in `ScreenCaptureService.onStartCommand`.
- Nothing renders on the `<canvas>` — check whether `"frame"` events are
  arriving at all (a plugin registration issue: `MainActivity.onCreate` must
  call `registerPlugin(ScreenCapturePlugin.class)` **before** `super.onCreate()`)
  versus arriving but failing to decode (a malformed JPEG from the
  `Image`-to-`Bitmap` conversion in `ScreenCaptureService.processImage`).
- The share never ends when it should, or ends when it shouldn't — the
  `stateChange` → `track.dispatchEvent(new Event("ended"))` wiring in
  `lib/androidScreenCapture.ts` is what connects the system's own "Stop
  sharing" affordance back to `useRoomMedia`'s teardown; a break there would
  leave the UI showing an active share the OS already killed.

## The `golive://` scheme is shared with the desktop app

`AndroidManifest.xml`'s intent-filter registers the exact same scheme
`electron-builder.yml` registers for Windows/macOS/Linux. Both shells
implement the same handoff (see `electron/README.md`'s OAuth diagram — it
applies here verbatim, just with `Browser.open()` standing in for
`shell.openExternal` and `lib/capacitorBridge.ts`'s in-memory `pendingLogins`
map standing in for `main.ts`'s), and `OpenInAppBanner`'s "abrir no app" link
resolves to whichever shell is installed without the site needing to know
which one that is.

## Layout

| File                                                       | Role                                                                  |
| ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| `../capacitor.config.ts`                                   | Points the WebView at the deployed site (like `main.ts`'s `APP_URL`) |
| `../lib/capacitorBridge.ts`                                | `window.golive` — OAuth, deep links, app version                      |
| `../lib/androidScreenCapture.ts`                           | The JS half of screen sharing — plugin bridge → canvas → MediaStream |
| `../components/CapacitorBridge.tsx`                        | Mounts the OAuth bridge once, in the root layout                      |
| `app/src/main/AndroidManifest.xml`                         | Permissions, the `golive://` intent-filter, the capture service       |
| `app/src/main/java/me/nemtudo/golive/MainActivity.java`    | `BridgeActivity` — registers `ScreenCapturePlugin`                    |
| `app/src/main/java/me/nemtudo/golive/ScreenCapturePlugin.java`  | JS-facing plugin: consent dialog, POST_NOTIFICATIONS, start/stop  |
| `app/src/main/java/me/nemtudo/golive/ScreenCaptureService.java` | Foreground service: MediaProjection, VirtualDisplay, JPEG encode  |
| `app/build.gradle`                                         | `versionName` synced from `package.json`, release signing             |
| `keystore.properties.example`                              | Template for the (gitignored) release-signing config                  |

## Scripts

```bash
npm run android:sync    # cap sync android — copies config, refreshes plugins
npm run android:open    # sync, then open the project in Android Studio
npm run android:assets  # regenerate launcher icons/splash from resources/icon.png
```

Building an APK/AAB itself needs Android Studio (or its command-line SDK +
`./gradlew`) installed, which this repo cannot do for you — `android:open` is
the fastest path from a clean clone to a device.

## Before shipping to Google Play

- **Release signing.** Copy `keystore.properties.example` to
  `keystore.properties` (already gitignored — see the root `.gitignore`'s
  "Android shell build output" section) and point it at a real keystore. Play
  ties a listing to the key that first uploaded it: losing the key means
  losing the ability to update the app, not just re-signing it. Without this
  file, `app/build.gradle` falls back to an unsigned/debug-signed build —
  enough to confirm the app still builds, not enough to upload.
- **Launcher icon and splash screen.** `cap add android` scaffolds
  Capacitor's own placeholder icon, not GoLive's. `resources/icon.png` (a
  copy of `public/icon.png`) is already in place as the input; run
  `npm run android:assets` to generate every density from it (needs `sharp`'s
  native binary — `npm install-scripts approve sharp` if it was blocked on
  install, per npm's warning at install time).
- **`versionCode`** in `app/build.gradle` is a plain integer, bumped by hand
  on every release that goes to Play — `versionName` tracks `package.json`
  automatically, but Play's own strictly-increasing-integer requirement has
  no honest way to derive from semver (see that file's comment).
- **Play's Data Safety form** will ask about the `CAMERA`, `RECORD_AUDIO` and
  screen-capture (`MediaProjection`) capabilities declared in the manifest:
  all three are used live, during a call, for the room's video/audio tracks —
  never recorded to disk or sent anywhere but the peers already in that room.
  Play also reviews apps that request `FOREGROUND_SERVICE_MEDIA_PROJECTION`
  somewhat more closely at submission time; the ongoing notification
  `ScreenCaptureService` shows while sharing (with a tap-to-return action) is
  what that review is checking for — a share must be visibly disclosed to the
  user for as long as it runs, not just consented to once at the start.

## Known platform limits

- **The "Tela cheia" (fullscreen) button is untested in this shell.**
  `VideoTile.tsx`/`VideoSourceTile.tsx` call the standard
  `Element.requestFullscreen()`, which needs no special permission on
  Chromium the way `electron/main.ts`'s `installPermissionHandlers` has to
  explicitly allow it for Electron specifically (an Electron-only funnel, not
  a Chromium requirement — see that file's comment). Android WebView should
  honor it the same way desktop Chrome does, but this was not verified against
  a device/emulator as part of this change; if the button turns out to be a
  no-op in practice, the fix is a custom `WebChromeClient` overriding
  `onShowCustomView`/`onHideCustomView` in a `MainActivity` that stops being a
  stock `BridgeActivity`.
- **Screen sharing is capped at 1280×720/15fps**, well under what the quality
  picker otherwise offers — see "Real screen sharing, and its trade-offs"
  above for why (a JPEG-per-frame plugin bridge, not a hardware encoder).
  Readable for documents/UI, soft on fast motion.
- **Screen sharing carries no audio.** The native capture is video-only;
  Android's separate `AudioPlaybackCapture` API (system/app audio, not
  MediaProjection's own) was out of scope for this change.
- **A backgrounded app can still lose its call.** `lib/useBackgroundKeepAlive.ts`'s
  silent-audio trick (which buys a WebView more time before Android
  suspends its JS/WebSocket/RTCPeerConnection) already applies inside this
  shell unchanged — the user agent it checks for is unaffected by running
  inside Capacitor. OEM battery-optimisation layers (MIUI, One UI, etc.) can
  still override it regardless of shell.

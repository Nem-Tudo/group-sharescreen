// IPC channel names, shared between main and the two preloads.
//
// Kept in one file so a rename can never leave one side listening on a
// string the other stopped sending — an IPC channel is a stringly-typed
// contract and nothing else would catch the drift.

export const IPC = {
  /** renderer -> main: open an OAuth start URL in the system browser. */
  oauthStart: "golive:oauth:start",
  /** renderer -> main: give up on a pending login. */
  oauthCancel: "golive:oauth:cancel",
  /** renderer -> main: open an arbitrary URL in the default browser. */
  openExternal: "golive:open-external",
  /** main -> renderer: app metadata, resolved once at preload time. */
  appInfo: "golive:app-info",

  /**
   * main -> renderer: a shell update finished downloading and is sitting on
   * disk, ready to be applied. Payload is the version string.
   */
  updateReady: "golive:update:ready",
  /**
   * renderer -> main: the version already downloaded, or null. The push
   * above can (and usually does) fire while no page is listening — the site
   * reloads on every navigation, and the download lands 45s after launch —
   * so the button needs a way to ask rather than only being told.
   */
  updatePending: "golive:update:pending",
  /** renderer -> main: quit and apply the downloaded update now. */
  updateInstall: "golive:update:install",
  /**
   * renderer -> main: check GitHub for a release right now, instead of
   * waiting for the next scheduled poll. Sent when the site relays the
   * admin panel's "lançar atualização" broadcast.
   */
  updateCheck: "golive:update:check",

  /** picker -> main: the sources to show, and the state of the audio switch. */
  pickerList: "golive:picker:list",
  /**
   * picker -> main: the applications that currently have sound, for the
   * per-app mute panel.
   *
   * Separate from pickerList, and asked for only when that panel is opened,
   * because it is not free: it enumerates the machine's audio sessions and
   * reads an icon out of every executable it finds. Paying that on every
   * picker open would delay the window everyone sees for a panel almost
   * nobody opens.
   */
  pickerAudioApps: "golive:picker:audio-apps",
  /** picker -> main: the user's choice (see PickerChoice), or null to cancel. */
  pickerChoose: "golive:picker:choose",

  /**
   * renderer -> main: begin capturing system audio with GoLive's own output
   * left out of it (see electron/systemAudio.ts). Answers whether it
   * actually started — false means the renderer should ask getDisplayMedia
   * for audio the ordinary way instead.
   *
   * Deliberately called *before* getDisplayMedia rather than after: a
   * capture already running is exactly how the display-media handler knows
   * not to attach Electron's own loopback track to the same share.
   */
  systemAudioStart: "golive:system-audio:start",
  /** renderer -> main: stop the capture started above. */
  systemAudioStop: "golive:system-audio:stop",
  /** main -> renderer: one chunk of PCM, in SYSTEM_AUDIO_FORMAT. */
  systemAudioData: "golive:system-audio:data",
  /**
   * main -> renderer: the helper exited on its own (a device was
   * invalidated, or it crashed). No more chunks are coming.
   */
  systemAudioEnded: "golive:system-audio:ended",

  /**
   * renderer -> main: this installation's id (see the site's
   * lib/installId.ts), so main can drop it somewhere the *uninstaller* can
   * read it — the renderer keeps it in localStorage, which NSIS has no way
   * to open (it is a LevelDB directory, not a file).
   *
   * The only reason this crosses the bridge at all. Nothing in the shell
   * reads the value otherwise.
   */
  installIdReport: "golive:install-id:report",

  /**
   * renderer -> main: read the background settings — whether the shell keeps
   * running in the tray after the window is closed, and whether it starts
   * with the system.
   *
   * The two together are the desktop's *entire* answer to "the ring has to
   * arrive with the app closed": Electron has no push service, so there is
   * nothing anybody can send to a desktop app that is not running. What there
   * can be is an app that is still running — quietly, in the tray, with its
   * socket open — which is the same thing every other desktop chat app does
   * and for the same reason.
   */
  backgroundGet: "golive:background:get",
  /** renderer -> main: change one of those settings. */
  backgroundSet: "golive:background:set",
  /**
   * renderer -> main: somebody is calling, or has stopped calling.
   *
   * Carries who is calling (see CallRingingInfo) rather than a bare boolean,
   * because the shell now has to be able to *draw* the call: when the window
   * is closed to the tray, throwing the whole app back on screen to answer one
   * question is the wrong answer, so main opens a small window with just the
   * ring in it (see call-overlay.html). It cannot do that without a name and a
   * face.
   *
   * Null the moment the call is over — a window left ringing about a call that
   * already ended is worse than one that never opened.
   */
  callRinging: "golive:call:ringing",
  /** overlay -> main: what to show. Asked for once, as the window opens. */
  callOverlayData: "golive:call:overlay-data",
  /**
   * main -> overlay: show somebody else instead.
   *
   * The window is opened once and reused, so without this a second caller
   * arriving while the first is still ringing left the window showing the
   * first person's name over buttons that answered the second one's call —
   * answering the wrong person, silently.
   */
  callOverlayUpdate: "golive:call:overlay-update",
  /** overlay -> main: the button that was pressed, and any typed reason. */
  callOverlayChoose: "golive:call:overlay-choose",
  /**
   * main -> renderer: act on what was pressed in that small window.
   *
   * The overlay itself does nothing: it has no session, no token and no socket,
   * and giving it any of those would mean a second copy of the sign-in state
   * living in the shell. It reports a button press, and the page — which is
   * still running behind the hidden window, holding the connection it has held
   * all along — does the actual accepting or refusing.
   */
  callAction: "golive:call:action",

  /**
   * renderer -> main: show a notification in the shell's own window, in the
   * bottom-right corner of the primary monitor, instead of a system toast.
   *
   * Only ever sent by the one connection of the account that is meant to make
   * the noise (see the API's electAlertTarget) — which, whenever this app is
   * running, is this app. See toast.html.
   */
  toastShow: "golive:toast:show",
  /** toast -> main: what to show. Asked for once, as the window opens. */
  toastData: "golive:toast:data",
  /** main -> toast: show this one instead — a newer notification replaces the one up. */
  toastUpdate: "golive:toast:update",
  /** toast -> main: it was clicked, or it went away on its own / was closed. */
  toastAction: "golive:toast:action",
  /**
   * main -> renderer: the notification with this id was clicked. The page
   * runs whatever the notification was about (opening the conversation, the
   * group room) — the shell has already brought the window up by then.
   */
  toastClick: "golive:toast:click",

  /** renderer -> main: register or update global shortcuts map. */
  shortcutsSet: "golive:shortcuts:set",
  /** main -> renderer: a registered global shortcut fired. */
  shortcutsTriggered: "golive:shortcuts:triggered",
  /**
   * renderer -> main: the next getDisplayMedia should reuse the last shared
   * source instead of opening the picker.
   *
   * Answers whether there is one to reuse, so the caller knows whether the
   * share it is about to start will be silent or will still put a window on
   * screen. A one-shot: main clears it on the first request that reads it.
   */
  shareUseSaved: "golive:share:use-saved",
} as const;

/**
 * The wire format of the PCM on `systemAudioData`, shared so the native
 * helper, the shell and the web app's AudioWorklet cannot drift apart on it.
 * Interleaved little-endian signed 16-bit — which is what a Buffer from the
 * helper already is, and one multiply away from what Web Audio wants.
 *
 * Fixed rather than negotiated because process loopback is not tied to an
 * audio endpoint: the capture asks the audio engine for this format and gets
 * it, instead of having to accept whatever a device's mix format happens to
 * be.
 */
export const SYSTEM_AUDIO_FORMAT = {
  sampleRate: 48000,
  channels: 2,
  bitsPerSample: 16,
} as const;

/** Who is calling, as the small ringing window needs to draw them. */
export interface CallRingingInfo {
  /** The call id, echoed back with the choice so a stale window cannot answer. */
  id: string;
  name: string;
  avatarUrl: string | null;
}

/**
 * Everything the ringing window needs to draw itself.
 *
 * The logo rides along rather than being loaded from disk by the window
 * itself: that window is a local file under a strict CSP with no `file:`
 * image source, and handing it a data URL keeps it that way. Read once by
 * main from the same icon the tray uses.
 */
export interface CallOverlayData {
  call: CallRingingInfo;
  /** The GoLive mark as a data URL, or null if the icon could not be read. */
  logo: string | null;
}

/** One notification, as the corner window draws it. */
export interface ToastInfo {
  /** Echoed back on a click, so the page knows which notification it was. */
  id: string;
  title: string;
  body: string;
  /** A face or a group icon (https, or our own origin), or null for the GoLive mark. */
  icon: string | null;
}

/** Everything the corner window needs to draw itself. */
export interface ToastWindowData {
  toast: ToastInfo;
  /** The GoLive mark as a data URL — same reasoning as CallOverlayData.logo. */
  logo: string | null;
}

/** What happened to the notification on screen. */
export interface ToastAction {
  action: "click" | "dismiss";
  /** Which one — a click on one already replaced must not open the newer one's target. */
  id: string;
}

/** What was pressed in that window. */
export interface CallOverlayChoice {
  action: "accept" | "decline";
  /** The typed refusal, when there was one. Never present on "accept". */
  reason?: string;
}

/**
 * The background settings, as the tray and the website both see them.
 *
 * `supported` is false where the platform has no login-item concept Electron
 * can drive, and the website hides the switch rather than offering one that
 * silently does nothing.
 */
export interface BackgroundSettings {
  /** Closing the window leaves the app running in the tray. */
  runInBackground: boolean;
  /** The app starts with the system, hidden. */
  openAtLogin: boolean;
  supported: boolean;
}

// Prefix of the argv entry main.ts injects via `additionalArguments` to hand
// the app version to the sandboxed preload — see preload.ts's readVersion.
export const VERSION_ARG = "--golive-version=";

// Present in the same argv when this machine can capture system audio with
// GoLive's own output excluded (Windows 11 or later, helper binary present —
// see systemAudio.ts's isSystemAudioExclusionSupported). The preload uses it
// to decide whether to expose the `systemAudio` half of the bridge at all,
// so the website's feature check is "does this function exist" rather than a
// round trip it would have to make before every share.
export const SYSTEM_AUDIO_ARG = "--golive-system-audio-exclusion";

/** What the picker window renders for each capturable surface. */
export interface PickerSource {
  id: string;
  name: string;
  /** PNG data URL of the live thumbnail. */
  thumbnail: string;
  /** Screens are listed before windows and labelled differently. */
  kind: "screen" | "window";
  /** App icon, when the OS provides one (windows only). */
  appIcon: string | null;
}

/** One row of the picker's "do not share sound from these apps" panel. */
export interface PickerAudioApp {
  /** Lower-cased executable file name — what the mute list is written in. */
  key: string;
  /** What the vendor calls it ("Discord"), or the file name as a fallback. */
  name: string;
  /** PNG data URL of the executable's icon, when one could be read. */
  icon: string | null;
  /** Whether its sound is currently left out of a share. */
  muted: boolean;
  /**
   * GoLive itself: shown muted and not switchable. Its exclusion is what
   * stops the room from hearing its own voices come back through the share,
   * so it is a fact about how the capture works rather than a preference —
   * and a switch that pretended otherwise would be one that breaks the call.
   */
  locked: boolean;
}

/** Everything the picker window needs to draw itself. */
export interface PickerData {
  sources: PickerSource[];
  /**
   * The source id to open pre-selected — the last one shared, resolved
   * against this very list, or null when there is nothing remembered or it is
   * no longer on screen.
   *
   * Resolved in main rather than sent as "whatever was saved", because a
   * saved id can be stale (a window's id is rebuilt from its OS handle every
   * launch) and the picker has no way to tell a stale id from an absent one.
   * What arrives here is always something in `sources`.
   */
  selectedId: string | null;
  audio: {
    /**
     * Whether a share on this machine can carry system audio at all. False
     * on macOS and Linux, where Electron has no loopback capture and there
     * is no equivalent without a virtual audio device — the whole audio row
     * is hidden rather than shown as a switch that does nothing.
     */
    supported: boolean;
    /**
     * Whether individual applications can be left out. Needs the native
     * helper; without it the only choice on offer is all of the sound or
     * none of it, so the gear is hidden and the checkbox stays.
     */
    perApp: boolean;
    /** The "Compartilhar som da tela" checkbox. */
    enabled: boolean;
  };
}

/** What the picker sends back when the user confirms. */
export interface PickerChoice {
  /** The chosen source id, or null for a cancellation. */
  id: string | null;
  /**
   * The audio settings as they stood on confirm. Absent on a cancellation:
   * dismissing the picker calls the whole share off, including any change
   * made to these while it was open.
   */
  audio?: {
    enabled: boolean;
    /**
     * Lower-cased executable file names. Never includes GoLive's own, whose
     * exclusion is not a setting.
     *
     * Absent when the user never opened the settings panel, which is not the
     * same as an empty list and must not be read as one: the panel is where
     * the picker *learns* what is muted, so before it has been opened the
     * window genuinely does not know, and main keeps what it had saved.
     * Sending [] instead would un-mute everything for everybody who shares
     * without opening the panel — which is almost everybody.
     */
    muted?: string[];
    /**
     * Every application the panel actually showed — which is only the ones
     * open at the time.
     *
     * Sent alongside `muted` because the panel is a view of part of the
     * setting, not all of it: an application that was muted and has since
     * been closed is not on screen to stay ticked, and replacing the saved
     * list with what the panel could see would silently forget it. main
     * changes only the keys named here.
     */
    listed?: string[];
  };
}

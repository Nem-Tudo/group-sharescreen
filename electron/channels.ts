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

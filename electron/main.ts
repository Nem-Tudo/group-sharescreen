// GoLive desktop shell.
//
// This is a *shell around the deployed site*, not a second copy of it. The
// window loads https://golive.nemtudo.me (or whatever GOLIVE_APP_URL says)
// and the entire UI, all the WebRTC, the whole mesh/cascade implementation
// come from there unchanged. That is a deliberate choice and worth stating,
// because the obvious alternative — bundling the Next build inside the app —
// would buy nothing here: this is a real-time communication app, so it is
// useless without a network connection anyway, and the site has server-side
// API routes (/api/giphy, /api/umami) that a static export cannot serve. One
// deploy, one thing to keep working.
//
// What the shell genuinely adds, and what all the code below is for:
//
//   1. A screen picker. Electron does not implement getDisplayMedia's own
//      chooser, so without setDisplayMediaRequestHandler the app's single
//      most important feature simply fails.
//   2. A working OAuth flow. Providers refuse to authenticate inside an
//      embedded browser, so login has to leave the app and come back.
//   3. The security posture a remote-content window requires: no Node in the
//      renderer, no navigating away from our own origin, no in-app windows
//      for third-party links.

import {
  app,
  BrowserWindow,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  session,
  shell,
  type DesktopCapturerSource,
} from "electron";
import path from "node:path";
import fs from "node:fs";
import {
  IPC,
  SYSTEM_AUDIO_ARG,
  VERSION_ARG,
  type PickerAudioApp,
  type PickerChoice,
  type PickerData,
  type PickerSource,
} from "./channels";
// The website's own definition of the marker path, imported rather than
// re-implemented: both sides have to agree on the exact nonce format or a
// perfectly good login is silently dropped, and a regex copied into two
// files is precisely the kind of thing that drifts. The module is pure —
// no React, no imports, nothing that touches `window` at load time — so it
// bundles into the main process without dragging the app in with it.
import { desktopOAuthNonce } from "../lib/desktop";
import { initAutoUpdater } from "./updater";
import { getSavedShareSource, saveShareSource } from "./shareSource.js";
import {
  getSystemAudioSettings,
  normalizeMutedApps,
  ownAppKey,
  saveSystemAudioSettings,
} from "./audioSettings";
import {
  applySystemAudioSettings,
  isSystemAudioCapturing,
  isSystemAudioExclusionSupported,
  listAudioApps,
  listOpenApps,
  startSystemAudioCapture,
  stopSystemAudioCapture,
} from "./systemAudio";

// Where the UI comes from. Overridable so `npm run electron:dev` can point at
// a local `next dev` without a rebuild.
const APP_URL = process.env.GOLIVE_APP_URL || "https://golive.nemtudo.me";
const APP_ORIGIN = new URL(APP_URL).origin;

// Registered with the OS so the OAuth result can find its way back — see
// startOAuth below and the web app's lib/desktop.ts.
const PROTOCOL = "golive";

// Must match electron-builder.yml's `appId`. On Windows, a renderer's
// `new Notification()` (see lib/notifications.ts) silently shows nothing unless
// the process declares this same AppUserModelID — the OS keys toasts to the
// installed app's identity, and without it every notification is dropped with
// no error. Harmless on macOS/Linux.
const APP_USER_MODEL_ID = "me.nemtudo.golive";

// A login the user never finishes would otherwise leave a promise pending in
// the renderer forever. Generous, because the flow legitimately involves
// typing a password and possibly a 2FA code in another application.
const OAUTH_TIMEOUT_MS = 5 * 60_000;

let mainWindow: BrowserWindow | null = null;

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

// Logins currently waiting on the browser, keyed by the nonce the renderer
// generated. The nonce is the whole security story here: any application on
// the machine can register a custom protocol handler and fire a
// `golive://oauth#token=...` at us, so an unsolicited fragment must not be
// accepted. Only a nonce we are actively waiting on resolves anything.
const pendingLogins = new Map<
  string,
  { resolve: (fragment: string | null) => void; timer: NodeJS.Timeout }
>();

function settleLogin(nonce: string, fragment: string | null) {
  const pending = pendingLogins.get(nonce);
  if (!pending) return;
  pendingLogins.delete(nonce);
  clearTimeout(pending.timer);
  pending.resolve(fragment);
}

function startOAuth(startUrl: string, nonce: string): Promise<string | null> {
  // The URL is built by the renderer, but the renderer is remote content —
  // so it is checked here rather than trusted. Without this, an XSS on the
  // site could use the desktop app as a launcher for arbitrary URLs.
  let parsed: URL;
  try {
    parsed = new URL(startUrl);
  } catch {
    return Promise.resolve(null);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    settleLogin(nonce, null);
    const timer = setTimeout(() => settleLogin(nonce, null), OAUTH_TIMEOUT_MS);
    pendingLogins.set(nonce, { resolve, timer });
    void shell.openExternal(startUrl).catch(() => settleLogin(nonce, null));
  });
}

// Points the window at a room and brings the app forward.
function openRoom(handle: string) {
  const url = `${APP_URL}/watch/${encodeURIComponent(handle)}`;
  // Handed to createWindow as the *initial* URL rather than loaded after the
  // fact: a cold start from a protocol link (Windows/Linux deliver those in
  // argv, before any window exists) would otherwise load the home page and
  // then immediately navigate away from it.
  if (!mainWindow) {
    createWindow(url);
    return;
  }
  void mainWindow.loadURL(url);
  focusMainWindow();
}

function focusMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

// Everything the OS hands us on the `golive://` scheme. Two routes today:
// `oauth`, whose fragment is exactly what the site's callback page received
// (forwarded verbatim, so the renderer parses it with the same parser the
// browser path uses), and `watch`, a room link handed over from a browser.
function handleDeepLink(rawUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return;
  }
  if (parsed.protocol !== `${PROTOCOL}:`) return;

  // `new URL("golive://oauth#x")` puts "oauth" in `host`, not `pathname` —
  // custom schemes are parsed as authority-based here. Accepting either
  // keeps this working regardless of how the OS hands the string over.
  const route = parsed.host || parsed.pathname.replace(/^\/+/, "");

  // A room link handed over from the browser: golive://watch/<handle>.
  // This is what makes "open in the app" possible at all — a website cannot
  // detect whether an app is installed (browsers deliberately prevent it),
  // so the site offers the handoff and the OS decides whether anything
  // answers it.
  if (route === "watch") {
    const handle = decodeURIComponent(parsed.pathname.replace(/^\/+/, "")).trim();
    // Validated rather than trusted. Anything can invoke a protocol URL, so
    // without this a crafted link could push the window to an arbitrary path
    // on our origin — mirrors the site's own HANDLE_RE.
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(handle)) return;
    openRoom(handle);
    return;
  }

  if (route !== "oauth") return;

  const fragment = parsed.hash;
  const next = new URLSearchParams(fragment.replace(/^#/, "")).get("next") ?? "";
  const nonce = desktopOAuthNonce(next);
  if (!nonce) return;
  settleLogin(nonce, fragment);

  // The user's attention is in the browser at this point; bring them back.
  focusMainWindow();
}

// ---------------------------------------------------------------------------
// Screen picker
// ---------------------------------------------------------------------------

/** A confirmed choice, with the audio settings already resolved to a value. */
interface ResolvedChoice {
  id: string | null;
  audio: { enabled: boolean; mutedApps: string[] } | null;
}

interface PickResult {
  /** The surface to capture, or null when the picker was dismissed. */
  source: DesktopCapturerSource | null;
  /** The audio settings as confirmed, or null on a dismissal. */
  audio: ResolvedChoice["audio"];
}

// Shown only when the OS has no picker of its own (see useSystemPicker
// below). Its own window rather than something rendered by the site, because
// the site must never be handed the source list — or the list of applications
// making sound, which the audio settings need: between them they name every
// open window and every program running on the machine, which is a meaningful
// amount of information about the user, and remote content has no business
// seeing it before a choice is made.
/**
 * One-shot: the next getDisplayMedia should reuse the last source instead of
 * opening the picker.
 *
 * A flag rather than an argument because the renderer cannot pass anything to
 * this handler — it calls the standard getDisplayMedia, and the shell only
 * hears about it through setDisplayMediaRequestHandler. Armed over IPC just
 * before that call, and cleared by the first request that reads it, so a
 * shortcut cannot silently arm every future share.
 */
let reuseSavedSourceOnce = false;

/**
 * The saved source, matched against what is actually open now — or null.
 *
 * Two passes, in this order, and the order is the whole of it. An exact id is
 * the same surface with certainty. A name match is a guess that is right
 * almost always for a window whose id went stale across a restart, and can be
 * wrong — two windows of the same application often share a title. So it is
 * only ever reached when the certain answer is not available.
 *
 * A screen that has been unplugged and a window that has been closed both
 * return null here, which puts the picker back. That is the right failure:
 * silently sharing a *different* monitor because it happened to inherit the
 * id would be worse than asking.
 */
function matchSavedSourceIn(sources: DesktopCapturerSource[]): DesktopCapturerSource | null {
  const saved = getSavedShareSource();
  if (!saved) return null;
  const byId = sources.find((source) => source.id === saved.id);
  if (byId) return byId;
  if (!saved.name) return null;
  return (
    sources.find(
      (source) =>
        source.name === saved.name && source.id.startsWith(`${saved.kind}:`)
    ) ?? null
  );
}

async function resolveSavedShareSource(): Promise<DesktopCapturerSource | null> {
  if (!getSavedShareSource()) return null;
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    // No thumbnails and no icons: nothing is being drawn, and asking for a
    // bitmap of every open window is the expensive part of this call — the
    // point of skipping the picker is that this path is instant.
    thumbnailSize: { width: 0, height: 0 },
  });
  return matchSavedSourceIn(sources);
}

async function pickSource(parent: BrowserWindow | null): Promise<PickResult> {
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 320, height: 200 },
    fetchWindowIcons: true,
  });
  if (sources.length === 0) return { source: null, audio: null };

  const picker = new BrowserWindow({
    parent: parent ?? undefined,
    modal: Boolean(parent),
    width: 820,
    height: 600,
    show: false,
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: "Escolha o que compartilhar",
    backgroundColor: "#101014",
    webPreferences: {
      preload: path.join(__dirname, "picker-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  picker.setMenuBarVisibility(false);

  const payload: PickerSource[] = sources.map((source) => ({
    id: source.id,
    name: source.name,
    thumbnail: source.thumbnail.toDataURL(),
    kind: source.id.startsWith("screen:") ? "screen" : "window",
    appIcon: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : null,
  }));

  const data: PickerData = {
    // Pre-selects the last shared surface when it is still on this list —
    // see PickerData.selectedId. Matched here, where both the saved value
    // and the live list are in hand.
    selectedId: matchSavedSourceIn(sources)?.id ?? null,
    sources: payload,
    audio: {
      // Electron's loopback capture is a Windows capability; on macOS and
      // Linux there is no system audio to offer at all (see the handler
      // below), so the row is not drawn rather than drawn and inert.
      supported: process.platform === "win32" || process.platform === "linux",
      // Leaving individual applications out needs the native helper. Without
      // it the only honest choice is all of the sound or none of it.
      perApp: isSystemAudioExclusionSupported(),
      enabled: getSystemAudioSettings().enabled,
    },
  };

  return new Promise((resolve) => {
    let settled = false;
    const finish = (choice: ResolvedChoice | null) => {
      if (settled) return;
      settled = true;
      ipcMain.removeHandler(IPC.pickerList);
      ipcMain.removeHandler(IPC.pickerAudioApps);
      ipcMain.removeAllListeners(IPC.pickerChoose);
      if (!picker.isDestroyed()) picker.close();
      const id = choice?.id ?? null;
      resolve({
        source: sources.find((s) => s.id === id) ?? null,
        audio: choice?.audio ?? null,
      });
    };

    ipcMain.handle(IPC.pickerList, () => data);
    ipcMain.handle(IPC.pickerAudioApps, () => audioAppRows());
    ipcMain.on(IPC.pickerChoose, (_event, choice: unknown) => {
      finish(readPickerChoice(choice));
    });
    // Closing the window with the OS chrome is a cancellation like any other.
    picker.on("closed", () => finish(null));

    picker.once("ready-to-show", () => picker.show());
    void picker.loadFile(path.join(__dirname, "..", "picker.html"));
  });
}

// The rows of the picker's "do not share sound from these apps" panel: the
// applications that are open right now, and nothing else. A program that is
// closed is not something anyone is deciding about, and listing one — because
// it was muted at some point in the past — turns a list of things on screen
// into a list of settings, which is not what this control is.
//
// Two sources, because "open" has two honest readings and the union of them
// is what a person means: the windows on the desktop, and anything holding an
// audio stream. The second catches what the first misses — a music player
// minimised to the tray still has sound to mute.
async function audioAppRows(): Promise<PickerAudioApp[]> {
  const muted = new Set(getSystemAudioSettings().mutedApps);
  // GoLive is listed first and always. Its row is the explanation for the
  // whole panel — the share does not carry the room's own voices back into
  // it — so a list that silently omitted it would read as if it might.
  const rows = new Map<string, PickerAudioApp>();
  rows.set(ownAppKey(), {
    key: ownAppKey(),
    // Spelled out rather than app.getName(), which answers "sharescreen"
    // from a checkout — productName only reaches package.json in a packaged
    // build, and a row nobody recognises would defeat the point of listing
    // ourselves at all.
    name: "Go Live",
    icon: await fileIcon(process.execPath),
    muted: true,
    locked: true,
  });

  const [open, audible] = await Promise.all([listOpenApps(), listAudioApps()]);
  for (const entry of [...open, ...audible]) {
    if (rows.has(entry.key) || entry.self) continue;
    rows.set(entry.key, {
      key: entry.key,
      name: entry.name,
      icon: await fileIcon(entry.path),
      muted: muted.has(entry.key),
      locked: false,
    });
  }

  // GoLive first because it explains the panel; the rest alphabetically,
  // which is the only order a person can predict — the enumeration's own is
  // window z-order, and a list that reshuffled itself between openings would
  // be one nobody could find anything in twice.
  return [...rows.values()].sort((a, b) => {
    if (a.locked !== b.locked) return a.locked ? -1 : 1;
    return a.name.localeCompare(b.name, "pt-BR");
  });
}

async function fileIcon(exePath: string): Promise<string | null> {
  try {
    const icon = await app.getFileIcon(exePath, { size: "small" });
    return icon.isEmpty() ? null : icon.toDataURL();
  } catch {
    // A path that no longer exists, or one this process cannot read. The row
    // is still worth showing without its icon.
    return null;
  }
}

// The picker window is a local file of ours, so this is not a trust boundary
// in the way the website's bridge is — but the shape is checked all the same,
// because what comes back is written straight to disk and used to pick which
// processes get recorded.
function readPickerChoice(value: unknown): ResolvedChoice | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : null;
  const audio = record.audio as PickerChoice["audio"] | undefined;
  if (!audio || typeof audio !== "object") return { id, audio: null };
  return {
    id,
    audio: { enabled: audio.enabled !== false, mutedApps: mergeMutedApps(audio) },
  };
}

// The panel edits the applications it could show, and only those. Everything
// else the user had muted is carried over untouched — see PickerChoice's
// `listed`. An absent `muted` means the panel was never opened at all, which
// changes nothing.
//
// Resolved here so that everything downstream deals in a value rather than in
// "the user did not say", which is a distinction only this one boundary has.
function mergeMutedApps(audio: NonNullable<PickerChoice["audio"]>): string[] {
  const saved = getSystemAudioSettings().mutedApps;
  if (!Array.isArray(audio.muted)) return saved;
  const listed = new Set(normalizeMutedApps(audio.listed ?? []));
  const kept = saved.filter((key) => !listed.has(key));
  return [...new Set([...kept, ...normalizeMutedApps(audio.muted)])];
}

function installShareSourceHandlers() {
  // invoke/handle rather than send: the renderer waits for the answer before
  // calling getDisplayMedia, both so the arming cannot land *after* the
  // request it was meant for, and so it can tell whether a picker is about to
  // appear.
  ipcMain.handle(IPC.shareUseSaved, async () => {
    const source = await resolveSavedShareSource();
    // Only armed when there is genuinely something to reuse. Arming
    // optimistically would leave the flag set for whatever share came next
    // if this one never happened.
    reuseSavedSourceOnce = source !== null;
    return reuseSavedSourceOnce;
  });
}

function installDisplayMediaHandler() {
  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      // Every path out of this handler goes through `answer`, for two
      // reasons that both showed up as bugs.
      //
      // It must happen exactly once: getDisplayMedia is waiting on it, and
      // answering twice is as wrong as not answering at all.
      //
      // And it must not throw. Electron 38 raises "Video was requested, but
      // no video stream was provided" straight out of the callback when the
      // request asked for video and the answer carries none — which is
      // precisely how a *denial* is spelled here, so closing the picker threw
      // every time. Inside the async function below that became an
      // UnhandledPromiseRejectionWarning in the console: noise rather than
      // breakage (the denial itself lands, and the renderer gets its
      // NotAllowedError), but noise that hid anything genuinely wrong.
      let answered = false;
      const answer = (streams: Electron.Streams) => {
        if (answered) return;
        answered = true;
        try {
          callback(streams);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          // The denial complaint above, and only that. Anything else is a
          // real fault and gets said out loud rather than swallowed with it.
          if (!message.includes("no video stream was provided")) {
            console.error("[golive] Falha ao responder ao pedido de captura:", message);
          }
        }
      };

      void (async () => {
        // Armed by the renderer immediately before this call, for the global
        // shortcut (see IPC.shareUseSaved). Read and cleared here whatever
        // the outcome: if the saved surface is gone, this falls through to
        // the picker rather than staying armed for a later share nobody
        // asked to be silent.
        const reuseSaved = reuseSavedSourceOnce;
        reuseSavedSourceOnce = false;
        if (reuseSaved) {
          const savedSource = await resolveSavedShareSource();
          if (savedSource) {
            answer({
              video: savedSource,
              // The same conditions as the picker path below — see its
              // comment. Nothing about reusing a source changes what the
              // audio may be.
              audio:
                request.audioRequested &&
                  (process.platform === "win32" || process.platform === "linux") &&
                  !isSystemAudioCapturing() &&
                  getSystemAudioSettings().enabled
                  ? "loopback"
                  : undefined,
            });
            return;
          }
        }
        const { source, audio } = await pickSource(mainWindow);
        // Saved only on a confirmed share. Dismissing the picker calls the
        // whole thing off, and a setting the user changed on their way to
        // cancelling was never applied to anything.
        //
        // applySystemAudioSettings is what makes a change take effect on
        // *this* share rather than the next one: the renderer starts the
        // capture before calling getDisplayMedia — that is how the shell
        // knows to withhold its own loopback track — so by the time these
        // controls are touched the helpers are already running. See
        // systemAudio.ts.
        if (source && audio) {
          applySystemAudioSettings(saveSystemAudioSettings(audio));
        }
        // Remembered on a confirmed share only, for the same reason the audio
        // settings are: a source highlighted on the way to pressing cancel
        // was never shared, and offering it back as "the last one" would be
        // remembering a decision nobody made.
        if (source) {
          saveShareSource({
            id: source.id,
            name: source.name,
            kind: source.id.startsWith("window:") ? "window" : "screen",
          });
        }
        if (!source) {
          // An empty result surfaces in the renderer as the same
          // NotAllowedError a browser raises when the picker is dismissed,
          // which the web app already treats as a silent cancel rather than
          // an error worth showing.
          answer({});
          return;
        }
        answer({
          video: source,
          // System audio, and only where it actually exists. Electron's
          // loopback capture is a Windows capability; on macOS and Linux
          // there is no equivalent without a virtual audio device, and
          // asking for one anyway fails the *whole* request rather than
          // just the audio. Returning video alone instead degrades exactly
          // the way Firefox does, which the web app already handles (see
          // the NotReadableError retry in useRoomMedia's capture).
          //
          // isSystemAudioCapturing() is the other half of that: the site
          // starts our own capture (systemAudio.ts) before calling
          // getDisplayMedia, and when it did, attaching Electron's loopback
          // track here as well would put the room's own audio back into the
          // share — the exact echo the helper exists to remove. So a running
          // capture means video only, and the audio arrives as PCM instead.
          // The settings check is the picker's checkbox, and it matters in
          // one specific case: system audio was switched *off* when the share
          // started, so the renderer asked getDisplayMedia for audio the
          // ordinary way, and it is only off that nothing here would decline
          // to give it some.
          //
          // The mirror image — switched on during this picker, with no
          // capture running because it was off when the renderer asked — does
          // get Electron's loopback track, echo and all. That is the same
          // audio every machine without the helper gets, it is unmistakably
          // what the user just asked for, and the next share picks up the
          // helper properly.
          audio:
            request.audioRequested &&
              (process.platform === "win32" || process.platform === "linux") &&
              !isSystemAudioCapturing() &&
              getSystemAudioSettings().enabled
              ? "loopback"
              : undefined,
        });
      })().catch((err) => {
        // Anything that went wrong on the way to an answer — the source list
        // failing, the picker window dying, the saved-source lookup throwing.
        // Before this, such a throw left getDisplayMedia waiting forever and
        // the site stuck on a share that never starts or fails. Denying is
        // the honest outcome: the renderer treats it as a cancelled picker,
        // which is what the person will have seen.
        console.error("[golive] Pedido de captura falhou:", err);
        answer({});
      });
    },
    // Prefer the OS's own picker where one exists (macOS 15+, and Windows
    // as support lands): it is the interface the user already knows, it can
    // offer surfaces we cannot enumerate ourselves, and on macOS it is the
    // path that carries the system's own capture indicator. Our picker above
    // is the fallback for everywhere it is unavailable, and Electron only
    // calls the handler in that case.
    { useSystemPicker: true }
  );
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

// Windows and macOS take the window icon from the signed executable/bundle,
// which electron-builder fills in from electron/build/icon.png. Linux does
// not: there the icon has to be handed to the window explicitly or it shows
// the default Electron one in the taskbar. Resolved relative to dist/ so it
// works both from source and from inside app.asar.
const WINDOW_ICON = path.join(__dirname, "..", "build", "icon.png");

// Recovery for a bundle chunk that came back as something other than
// JavaScript — the failure that made the app unusable while the browser was
// fine:
//
//   GET /_next/static/chunks/<hash>.js  ->  408, Content-Type: text/html
//
// A chunk is `immutable, max-age=31536000`, so whatever answer this session
// gets for one is the answer it keeps. Cache a 408 error page under that URL
// once and the app is broken *permanently*: every launch replays it from disk,
// React never hydrates, and there is genuinely nothing the user can do from
// inside a window whose JavaScript never ran. A browser has Ctrl+F5; this has
// nothing, which is exactly why it needed handling here rather than in the
// site's own recovery script (see lib/chunkRecovery.ts, which covers the
// browser and cannot help once the renderer is dead).
//
// Watching responses in the main process is what makes this work at all: it
// does not depend on any code in the page, which is the code that is missing.
const CHUNK_PATH = "/_next/static/";
// Two, for the same reason the web side caps its own attempts: a chunk that is
// genuinely gone from the origin must not turn into an endless clear-and-reload
// loop. Past this the window is left as it is.
const MAX_CHUNK_RECOVERIES = 2;
let chunkRecoveries = 0;
let chunkRecoveryPending = false;

// Electron hands headers back as a map whose casing is not guaranteed, so the
// name has to be matched rather than indexed, and each value can be a list.
function headerValue(
  headers: Record<string, string[] | string> | undefined,
  name: string
): string | null {
  if (!headers) return null;
  const wanted = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() !== wanted) continue;
    const value = headers[key];
    return Array.isArray(value) ? value.join(",") : String(value);
  }
  return null;
}

function recoverFromBadChunk(url: string, why: string) {
  if (chunkRecoveryPending || chunkRecoveries >= MAX_CHUNK_RECOVERIES) return;
  chunkRecoveryPending = true;
  chunkRecoveries += 1;
  console.warn(`[golive] Chunk inutilizável (${why}): ${url}`);
  // Clearing the cache is the whole point — reloading alone would just replay
  // the poisoned entry, which is why the app could never recover on its own no
  // matter how many times it was restarted.
  void session.defaultSession
    .clearCache()
    .then(() => {
      // Jittered for the same reason the web side is: this failure arrives when
      // the origin is struggling, and every app instance reloading on the same
      // tick is a synchronised retry against it.
      setTimeout(() => {
        chunkRecoveryPending = false;
        // reloadIgnoringCache rather than reload: belt and braces against
        // anything the clear above did not reach.
        mainWindow?.webContents.reloadIgnoringCache();
      }, 500 + Math.random() * 2500);
    })
    .catch(() => {
      chunkRecoveryPending = false;
    });
}

// Whether this response is one whose failure actually breaks the app.
//
// `/_next/static/` is not only chunks: Next serves fonts from
// /_next/static/media, and this build puts the favicon and the map's marker
// PNGs there too. Those come back as font/woff2, image/x-icon and image/png —
// none of which is JavaScript, all of which are perfectly healthy, and every
// one of which the content-type test below used to read as "unusable". So a
// completely fine app cleared its cache and reloaded on launch, twice, until
// MAX_CHUNK_RECOVERIES stopped it: three page loads, three signaling
// connections, three disconnections, every single time. Only in the desktop
// app, because only the desktop app runs this.
//
// The extension, not the content-type, is what says whether we are entitled
// to an opinion — a .woff2 answering with font/woff2 is not evidence of
// anything, and the comment below about acting only on positive evidence was
// only ever true for the assets this now selects.
function isRecoverableAsset(url: string): boolean {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return false;
  }
  if (!pathname.includes(CHUNK_PATH)) return false;
  // A stylesheet is in scope alongside a script: it is equally cacheable,
  // equally immutable, and an app painted with no CSS is as unusable as one
  // that never hydrated. A font that fails to load is neither.
  return pathname.endsWith(".js") || pathname.endsWith(".css");
}

function installChunkRecovery() {
  const filter = { urls: [`${APP_ORIGIN}/_next/static/*`] };

  session.defaultSession.webRequest.onCompleted(filter, (details) => {
    if (!isRecoverableAsset(details.url)) return;

    // Act only on positive evidence that this response is unusable, never on
    // the absence of evidence. That distinction is the whole correctness of
    // this handler: a response served from Electron's own cache frequently
    // arrives here with no responseHeaders at all, and treating "I could not
    // read a content-type" as "this is broken" would clear the cache and
    // reload on every launch of a perfectly healthy app.
    if (details.statusCode < 200 || details.statusCode >= 300) {
      recoverFromBadChunk(details.url, `status ${details.statusCode}`);
      return;
    }
    const type = headerValue(details.responseHeaders, "content-type");
    // No content-type to judge, and the status was fine — nothing to act on.
    if (!type) return;
    // The observed failure was an HTML error page under a .js URL. A 200
    // serving one would be exactly as unexecutable and exactly as cacheable as
    // the 408 was, so the status check alone would have missed it.
    if (/javascript|ecmascript|text\/css/i.test(type)) return;
    recoverFromBadChunk(details.url, `content-type ${type}`);
  });

  // A request that never produced an HTTP response at all — DNS, TLS, a reset
  // connection — does not reach onCompleted. It is the same outcome for the
  // page (no chunk, no hydration) and it can equally leave a negative entry
  // behind, so it gets the same treatment.
  session.defaultSession.webRequest.onErrorOccurred(filter, (details) => {
    if (!isRecoverableAsset(details.url)) return;
    recoverFromBadChunk(details.url, details.error || "erro de rede");
  });
}

function createWindow(initialUrl: string = APP_URL) {
  mainWindow = new BrowserWindow({
    width: 1660,
    height: 1054,
    minWidth: 940,
    minHeight: 600,
    show: false,
    backgroundColor: "#101014",
    title: "GoLive",
    ...(process.platform === "linux" ? { icon: WINDOW_ICON } : {}),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      // The three settings that make loading remote content survivable. The
      // renderer runs the live website, so it must have no path to Node:
      // contextIsolation keeps the preload's own scope out of the page, and
      // sandbox puts the renderer in the OS sandbox on top of that.
      // Chromium throttles a renderer whose window is hidden, minimised or
      // covered: timers clamp to about once a second and rendering stops.
      // That is right for a browser tab nobody is looking at and wrong for
      // this app, whose whole point in the background is the global shortcuts
      // (see updateGlobalShortcuts). Those fire fine — they are registered
      // with the OS — and the IPC reaches the page, but the handler that acts
      // on it was being throttled along with everything else, so muting the
      // mic from another window felt broken or arrived seconds late.
      //
      // It costs what it says: a hidden window keeps running its timers. This
      // one is holding WebRTC connections open and metering audio the whole
      // time anyway, so there was no idle to protect.
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The only channel a sandboxed preload has for a value from here.
      // The audio flag rides along for the same reason the version does: the
      // preload has to decide whether to expose the systemAudio bridge at
      // all, and "is this Windows 11 with the helper present" is a question
      // only the main process can answer.
      additionalArguments: [
        `${VERSION_ARG}${app.getVersion()}`,
        ...(isSystemAudioExclusionSupported() ? [SYSTEM_AUDIO_ARG] : []),
      ],
      // Screen sharing is the entire point of the app and needs no gesture
      // ceremony; media playback (a shared video source) does.
      autoplayPolicy: "document-user-activation-required",
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Third-party links (Discord, the terms page, a shared YouTube URL) open
  // in the user's real browser. An in-app window for them would be a
  // browser without an address bar, which is exactly the shape a phishing
  // page wants to be shown in.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:$/.test(safeProtocol(url))) void shell.openExternal(url);
    return { action: "deny" };
  });

  // Same rule for in-place navigation. Anything that is not our own origin
  // leaves the app rather than replacing the UI inside it — without this, a
  // single stray link turns the shell into an uncontrolled browser.
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin === APP_ORIGIN) return;
    event.preventDefault();
    if (/^https?:$/.test(safeProtocol(url))) void shell.openExternal(url);
  });

  void mainWindow.loadURL(initialUrl);
}

function safeProtocol(url: string): string {
  try {
    return new URL(url).protocol;
  } catch {
    return "";
  }
}

// Where the uninstaller looks for this installation's id. Windows only,
// because it is the only platform whose installer can run anything on the
// way out: NSIS has a customUnInstall hook (see electron/build/installer.nsh),
// while a .dmg is uninstalled by dragging the app to the trash and an
// AppImage by deleting a file — neither gives anyone a chance to say goodbye.
//
// Deliberately NOT app.getPath("userData"). That directory's name comes from
// how Electron resolves the app name at runtime, which the .nsh would have to
// reproduce as a literal string — a guess that breaks silently, on the one
// path nobody exercises until somebody actually uninstalls. A directory both
// sides simply agree on has no such failure mode: this constant and the
// `$APPDATA\GoLive\install-id` in the .nsh are the entire contract.
//
// The id itself is not a secret and not proof of anything (see the site's
// lib/installId.ts) — a random number whose only job is to be the same one
// tomorrow. It stays in %APPDATA% rather than the install directory so the
// uninstaller can still read it after the program files are gone.
const INSTALL_ID_DIR_NAME = "GoLive";
const INSTALL_ID_FILE_NAME = "install-id";

// Same shape the server validates against, and for the same reason: this
// value ends up on a command line the uninstaller builds, so it is checked
// rather than trusted even though it arrived from our own origin.
const INSTALL_ID_PATTERN = /^[0-9a-fA-F-]{16,64}$/;

let lastWrittenInstallId: string | null = null;

function writeInstallIdFile(installId: string) {
  if (process.platform !== "win32") return;
  if (!INSTALL_ID_PATTERN.test(installId)) return;
  // The site reports this once per page load, and a page load happens on
  // every navigation. Writing the same bytes each time would be pointless
  // disk churn.
  if (installId === lastWrittenInstallId) return;
  try {
    const dir = path.join(app.getPath("appData"), INSTALL_ID_DIR_NAME);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, INSTALL_ID_FILE_NAME), installId, "utf8");
    lastWrittenInstallId = installId;
  } catch {
    // Best-effort by design: failing to write this costs an uninstall
    // report, which is a statistic, and must never cost anything else.
  }
}

// Camera, microphone and screen capture are the app's reason to exist and
// are granted; everything else a web page can ask for is refused outright
// rather than left to a default that may change between Electron versions.
//
// clipboard-sanitized-write is in that list for a less obvious reason: a
// browser grants navigator.clipboard.writeText() off the user gesture alone
// and never asks, so nothing on the site looks like it needs a permission —
// but Electron routes it here instead, and denying it made "Compartilhar
// sala" fail silently. Writing plain text the user just asked us to copy is
// not a capability worth withholding. ("sanitized" is Chromium's name for
// the text-only write; clipboard-read, which lets a page *read* what the
// user copied elsewhere, is deliberately not here.)
function installPermissionHandlers() {
  const allowed = new Set([
    "media",
    "display-capture",
    "audioCapture",
    "videoCapture",
    "clipboard-sanitized-write",
    // System notifications (chat mentions today, more later — see
    // lib/notifications.ts). Electron shows the renderer's `new Notification()`
    // as a native toast, but still routes the permission request here; without
    // this the web app's Notification.requestPermission() resolves to "denied"
    // in the app while working on the web. Notifications are a push the user
    // opted into, not a capability that can read anything, so granting them to
    // our own origin is safe.
    "notifications",
    // Same story as clipboard-sanitized-write: a browser lets
    // Element.requestFullscreen() through on the user gesture alone and
    // never asks, so nothing on the site looks like it needs permission —
    // but Electron routes it here, and denying it made the tiles'
    // "Tela cheia" button do nothing in the app while working on the web.
    "fullscreen",
  ]);
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const fromApp = webContents?.getURL().startsWith(APP_ORIGIN) ?? false;
    callback(fromApp && allowed.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => {
    return origin.startsWith(APP_ORIGIN) && allowed.has(permission);
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

// A second launch must hand its deep link to the running instance rather
// than starting a rival copy — on Windows and Linux the OS delivers a
// protocol activation by launching the app again with the URL in argv, so
// without this an OAuth callback would open a whole new window.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const deepLink = argv.find((arg) => arg.startsWith(`${PROTOCOL}://`));
    if (deepLink) handleDeepLink(deepLink);
    focusMainWindow();
  });

  // macOS delivers protocol activations as an event instead, and can do so
  // before the app has finished starting.
  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  app.whenReady().then(() => {
    // Declare the app identity to Windows before anything can raise a toast,
    // or notifications silently no-op (see APP_USER_MODEL_ID).
    app.setAppUserModelId(APP_USER_MODEL_ID);

    // In dev the executable is Electron itself, so the OS has to be told
    // which binary and argv to invoke — otherwise the protocol registers
    // against `electron.exe` with no script and the callback lands nowhere.
    if (process.defaultApp && process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
    } else {
      app.setAsDefaultProtocolClient(PROTOCOL);
    }

    installPermissionHandlers();
    installDisplayMediaHandler();
  installShareSourceHandlers();
    installChunkRecovery();

    ipcMain.handle(IPC.oauthStart, (_event, startUrl: unknown, nonce: unknown) => {
      if (typeof startUrl !== "string" || typeof nonce !== "string") return null;
      if (!/^[a-zA-Z0-9_-]{8,128}$/.test(nonce)) return null;
      return startOAuth(startUrl, nonce);
    });
    ipcMain.on(IPC.oauthCancel, (_event, nonce: unknown) => {
      if (typeof nonce === "string") settleLogin(nonce, null);
    });
    ipcMain.handle(IPC.openExternal, (_event, url: unknown) => {
      if (typeof url !== "string" || !/^https?:$/.test(safeProtocol(url))) return;
      return shell.openExternal(url);
    });

    // Parks the site's install id where the NSIS uninstaller can find it —
    // see writeInstallIdFile, and electron/build/installer.nsh for the half
    // that reads it. Origin-checked like the capabilities above: this writes
    // a file the uninstaller acts on, so it takes its value from our own
    // page and not from whatever happens to be loaded.
    ipcMain.on(IPC.installIdReport, (event, installId: unknown) => {
      if (!event.sender.getURL().startsWith(APP_ORIGIN)) return;
      if (typeof installId === "string") writeInstallIdFile(installId);
    });

    // Checked against our own origin like every other capability: the
    // renderer is remote content, and starting an OS-level audio capture is
    // not something an arbitrary page that ended up in this window should be
    // able to do. (Nothing else *can* be in this window — will-navigate
    // sends other origins to the browser — but the handler must not depend
    // on that being true forever.)
    ipcMain.handle(IPC.systemAudioStart, (event) => {
      if (!event.sender.getURL().startsWith(APP_ORIGIN)) return false;
      return startSystemAudioCapture(event.sender);
    });
    ipcMain.on(IPC.systemAudioStop, () => stopSystemAudioCapture());

    // Global keyboard shortcuts management
    ipcMain.on(IPC.shortcutsSet, (_event, shortcuts) => {
      if (shortcuts && typeof shortcuts === "object") {
        updateGlobalShortcuts(shortcuts as Record<string, string>);
      }
    });

    // A launch *from* a deep link on Windows/Linux arrives in this process's
    // own argv rather than through "second-instance". Read before the window
    // is created, not after: handling it afterwards would load the home page
    // and then immediately navigate away from it, which on a cold start is a
    // visible flash of the wrong page plus a wasted round trip.
    const initialLink = process.argv.find((arg) => arg.startsWith(`${PROTOCOL}://`));
    if (initialLink) {
      handleDeepLink(initialLink);
    }
    // Still needed when the link was not a room one (an OAuth callback that
    // launched the app, or no link at all) — openRoom creates the window
    // itself, so this must not make a second one.
    if (!mainWindow) createWindow();

    // Keeps the shell current. The website updates itself by being loaded
    // fresh; this is for the code that ships inside the executable.
    initAutoUpdater(APP_URL);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  function updateGlobalShortcuts(shortcuts: Record<string, string>) {
    globalShortcut.unregisterAll();
    for (const [action, accelerator] of Object.entries(shortcuts)) {
      if (!accelerator) continue;
      try {
        globalShortcut.register(accelerator, () => {
          mainWindow?.webContents.send(IPC.shortcutsTriggered, action);
        });
      } catch {
        // Ignore accelerators not supported by OS
      }
    }
  }

  // The helper is a child process holding an open audio client. Its own
  // stdin watchdog would end it once our pipes close, but doing it here
  // means it stops while WASAPI can still be shut down cleanly, rather than
  // during the process teardown that follows.
  app.on("will-quit", () => {
    stopSystemAudioCapture();
    globalShortcut.unregisterAll();
  });

  // macOS convention is that closing the window does not quit the app.
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}

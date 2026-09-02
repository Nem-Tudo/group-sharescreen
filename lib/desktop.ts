"use client";

import { Capacitor } from "@capacitor/core";

// The web app's half of the Electron bridge.
//
// Everything here is defensive by design: this file is part of the *website*,
// which is overwhelmingly loaded in an ordinary browser where none of this
// exists. `isDesktopApp()` is the only gate, and every consumer must keep
// working untouched when it returns false — the desktop build is an
// additional shell around the same site, never a fork of it.
//
// The bridge itself is injected by electron/preload.ts through
// contextBridge, so the renderer never sees `require`, `process`, or any
// Node primitive. What crosses the boundary is this interface and nothing
// else.

// Path prefix used as a *marker* in the OAuth `returnTo`, so the callback
// page can tell "this login was started from the desktop app" apart from an
// ordinary browser login. It has to live in the path specifically: the API
// validates `returnTo` against its origin allowlist and keeps only the
// pathname, dropping query and hash (see the API's resolveOrigin) — so the
// path is the one part of that URL that survives the round trip.
//
// The nonce appended to it is what binds a result back to the request that
// asked for it. Any application on the machine can register a custom
// protocol, so an unsolicited `golive://oauth#token=...` could otherwise be
// injected by another program; the desktop side only accepts a fragment
// whose nonce matches a login it is currently waiting on.
export const DESKTOP_OAUTH_RETURN_PREFIX = "/desktop/oauth/";

export function desktopOAuthReturnPath(nonce: string): string {
  return `${DESKTOP_OAUTH_RETURN_PREFIX}${nonce}`;
}

/** Extracts the nonce from a `next` value, or null when it isn't a desktop login. */
export function desktopOAuthNonce(next: string): string | null {
  if (!next.startsWith(DESKTOP_OAUTH_RETURN_PREFIX)) return null;
  const nonce = next.slice(DESKTOP_OAUTH_RETURN_PREFIX.length).replace(/\/+$/, "");
  return /^[a-zA-Z0-9_-]{8,128}$/.test(nonce) ? nonce : null;
}

export interface DesktopBridge {
  /** The packaged app's version, for the "about"/diagnostics line. */
  readonly appVersion: string;
  // "android" is the Capacitor shell (lib/capacitorBridge.ts) — same
  // contract, same DESKTOP_OAUTH_RETURN_PREFIX handoff, just a phone instead
  // of a desktop OS. Naming this file/function "desktop" predates that and is
  // now a bit narrow, but every consumer already treats "a golive shell
  // exists" as the one thing that matters, never which platform string it
  // carries — see the grep-worthy absence of any `.platform === "win32"`
  // check anywhere in the site's own code.
  readonly platform: "darwin" | "win32" | "linux" | "android";
  /**
   * Reuse the last shared screen/window for the very next getDisplayMedia,
   * instead of opening the picker. Resolves whether there was one to reuse.
   *
   * Optional because the shell is loaded live and an older build will not
   * have it — every caller has to treat its absence as "no", which is also
   * exactly the old behaviour.
   */
  readonly useSavedShareSource?: () => Promise<boolean>;
  /**
   * Opens `startUrl` in the user's *real* browser and resolves with the URL
   * fragment the OAuth flow eventually hands back through the app's custom
   * protocol — or null if it was cancelled or timed out.
   *
   * The system browser rather than a window of our own is not a preference:
   * providers actively refuse to authenticate inside embedded browsers
   * (Google returns `disallowed_useragent` outright), and the user's real
   * browser is also where they are already signed in to the provider.
   */
  startOAuth(startUrl: string, nonce: string): Promise<string | null>;
  /** Cancels a pending startOAuth, so its promise settles instead of hanging. */
  cancelOAuth(nonce: string): void;
  /** Opens a URL in the default browser. */
  openExternal(url: string): Promise<void>;

  // The three below are optional for a reason that applies to this whole
  // interface but bites hardest here: the bridge is injected by the *shell
  // the user installed*, while this file ships with the site. A build from
  // before these existed is still out there running today's site, so every
  // one of them must be treated as possibly absent — checked, not assumed.

  /** The version already downloaded and waiting to be applied, or null. */
  pendingUpdate?(): Promise<string | null>;
  /**
   * Subscribes to "an update just finished downloading". Returns an
   * unsubscribe function.
   */
  onUpdateReady?(callback: (version: string) => void): () => void;
  /** Quits and applies the downloaded update immediately. */
  installUpdate?(): void;
  /**
   * Asks the shell to check for a release right now rather than on its own
   * six-hourly schedule. Fire-and-forget: the answer, if there is one,
   * arrives later through onUpdateReady.
   */
  checkForUpdate?(): void;

  /**
   * Registers global shortcuts in the desktop shell so hotkeys work even
   * when another application has focus.
   */
  setGlobalShortcuts?(shortcuts: Record<string, string>): void;
  /**
   * Subscribes to global shortcut activations from the desktop shell.
   * Returns an unsubscribe function.
   */
  onGlobalShortcut?(callback: (action: string) => void): () => void;

  /**
   * System audio capture with GoLive's own output excluded — the thing that
   * stops a screen share from carrying the room's voices back to the room.
   * See lib/desktopSystemAudio.ts, which is the only thing that should touch
   * this, and electron/systemAudio.ts for what is on the other end.
   *
   * Absent on any machine that cannot do it, which is most of them: every
   * browser, macOS and Linux, Windows 10 (the process-loopback API needs
   * build 20348, which consumer Windows 10 never reached), and every desktop
   * build from before this existed. Its absence *is* the feature check.
   */
  systemAudio?: {
    /** The PCM format `onData` delivers. Interleaved little-endian. */
    readonly format: { sampleRate: number; channels: number; bitsPerSample: number };
    /**
     * Starts the capture. Resolves false when the helper could not be
     * started, which the caller must treat as "ask getDisplayMedia for audio
     * the ordinary way" rather than as an error.
     *
     * Has to be called before getDisplayMedia: the shell reads "a capture is
     * running" as "do not also attach my own loopback track to this share".
     */
    start(): Promise<boolean>;
    /** Stops the capture. Safe when nothing is running. */
    stop(): void;
    /**
     * Subscribes to the PCM. `onEnded` fires if the capture stops on its own
     * (a device invalidated, or the helper crashed). Returns an unsubscribe.
     */
    onData(onChunk: (chunk: Uint8Array) => void, onEnded: () => void): () => void;
  };
}

declare global {
  interface Window {
    golive?: DesktopBridge;
  }
}

export function getDesktopBridge(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  return window.golive ?? null;
}

export function isDesktopApp(): boolean {
  return getDesktopBridge() !== null;
}

/**
 * Specifically the Android shell (see lib/capacitorBridge.ts), as opposed to
 * the Electron one.
 *
 * Note what this is *not*: a narrowing of isDesktopApp() above, which stays
 * true for both and means "a GoLive shell exists at all". Every consumer of
 * that — the download button, the install prompt, the open-in-app banner —
 * wants exactly that question, and answering it differently on Android would
 * start offering the app to people already inside it.
 *
 * This one exists because the participant list does need to tell them apart:
 * a phone icon and a monitor icon say different things about who is in the
 * room — and because currentAnnouncementDevice() turns it into the
 * "mobile-app" the /metrics platform gauge and announcement targeting are
 * both keyed on.
 *
 * Asks Capacitor rather than `window.golive`, which is the whole point. The
 * two shells fill that bridge in at very different moments: Electron's
 * preload runs before any page script, so reading it is safe from the first
 * line of the bundle, while the Android one is assembled in an effect that
 * awaits two dynamic imports and two native calls (see initCapacitorBridge).
 * Meanwhile signalingClient's constructor registers a stored guest name at
 * module-eval time, and the device it reports is read once, at ws.onopen,
 * with nothing re-registering afterwards. Keyed on the bridge, that returning
 * guest was counted as "mobile-browser" for the life of the connection and
 * missed every announcement aimed at the app. Capacitor's own global is
 * injected by the native layer ahead of the page's scripts — the same thing
 * initCapacitorBridge already trusts synchronously on its first line — so
 * this answer is correct from the first render instead of a few hundred ms
 * in.
 *
 * Still false in an ordinary browser and in the Electron shell, where
 * getPlatform() is "web": on the site this is the same constant it always
 * was.
 */
export function isMobileApp(): boolean {
  if (typeof window === "undefined") return false;
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

// Nonces come from the platform CSPRNG rather than Math.random: this value
// is the only thing standing between a real login result and one injected by
// another process on the same machine (see the prefix comment above).
export function createOAuthNonce(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/**
 * Asks the desktop shell to start the next screen share from the last one's
 * source, with no picker.
 *
 * Resolves false anywhere that cannot do it — a browser, the Android shell, a
 * desktop build from before this existed, or a first share with nothing saved
 * — and false simply means the picker opens, which is what always happened.
 */
// "arm", not "use": a `use` prefix is reserved for React hooks, and this is a
// plain async call made from an event handler — named otherwise, every lint
// rule about hook ordering would apply to it and none of them would be right.
export async function armSavedShareSource(): Promise<boolean> {
  const bridge = getDesktopBridge();
  if (!bridge?.useSavedShareSource) return false;
  try {
    return await bridge.useSavedShareSource();
  } catch {
    return false;
  }
}

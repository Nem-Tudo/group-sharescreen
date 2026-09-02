// The only thing the website is allowed to see of the desktop shell.
//
// Nothing here forwards a raw ipcRenderer handle: each function is a named,
// argument-checked operation, so the surface the remote page can reach is
// exactly this file and not "IPC in general". That distinction is the whole
// reason contextIsolation exists — a bridge that exposes `ipcRenderer` has
// contextIsolation switched on and none of its benefit.
//
// The shape mirrors DesktopBridge in lib/desktop.ts, which is where the
// website's side of this contract is typed.

import { contextBridge, ipcRenderer } from "electron";
import { IPC, SYSTEM_AUDIO_ARG, SYSTEM_AUDIO_FORMAT, VERSION_ARG } from "./channels";

// A sandboxed preload cannot reach `app.getVersion()` — it has no main-process
// APIs at all — and `process.env` set in main is not propagated here either.
// `additionalArguments` (see main.ts's webPreferences) is the documented way
// to get a value across that boundary, and it arrives in argv.
function readVersion(): string {
  const arg = process.argv.find((a) => a.startsWith(VERSION_ARG));
  return arg ? arg.slice(VERSION_ARG.length) : "0.0.0";
}

contextBridge.exposeInMainWorld("golive", {
  appVersion: readVersion(),
  platform: process.platform,

  startOAuth(startUrl: unknown, nonce: unknown): Promise<string | null> {
    if (typeof startUrl !== "string" || typeof nonce !== "string") {
      return Promise.resolve(null);
    }
    return ipcRenderer.invoke(IPC.oauthStart, startUrl, nonce);
  },

  cancelOAuth(nonce: unknown): void {
    if (typeof nonce === "string") ipcRenderer.send(IPC.oauthCancel, nonce);
  },

  openExternal(url: unknown): Promise<void> {
    if (typeof url !== "string") return Promise.resolve();
    return ipcRenderer.invoke(IPC.openExternal, url);
  },

  // Fire-and-forget, and optional on the website's side: a shell from before
  // this existed simply doesn't have it, and the site checks for the
  // function rather than the version.
  reportInstallId(installId: unknown): void {
    if (typeof installId === "string") ipcRenderer.send(IPC.installIdReport, installId);
  },

  pendingUpdate(): Promise<string | null> {
    return ipcRenderer.invoke(IPC.updatePending);
  },

  onUpdateReady(callback: unknown): () => void {
    if (typeof callback !== "function") return () => {};
    // The IpcRendererEvent never crosses the bridge: it carries a `sender`
    // handle, which is both unserializable and exactly the sort of raw IPC
    // primitive this preload exists to keep away from a remote page. Only
    // the version string goes through.
    const listener = (_event: unknown, version: unknown) => {
      if (typeof version === "string") (callback as (v: string) => void)(version);
    };
    ipcRenderer.on(IPC.updateReady, listener);
    // Returned so React can drop the listener on unmount; without it a
    // component that mounts per navigation would stack one up every time.
    return () => {
      ipcRenderer.off(IPC.updateReady, listener);
    };
  },

  installUpdate(): void {
    ipcRenderer.send(IPC.updateInstall);
  },

  checkForUpdate(): void {
    ipcRenderer.send(IPC.updateCheck);
  },

  setGlobalShortcuts(shortcuts: unknown): void {
    if (shortcuts && typeof shortcuts === "object") {
      ipcRenderer.send(IPC.shortcutsSet, shortcuts);
    }
  },

  /**
   * Asks the shell to reuse the last shared screen/window for the very next
   * getDisplayMedia, skipping the picker. Resolves true when there was one to
   * reuse — false means the picker will open as usual, which is what happens
   * before anything has ever been shared, or when the saved monitor has been
   * unplugged since.
   *
   * Must be awaited immediately before getDisplayMedia: it is a one-shot on
   * the other side, spent by the first request that reads it.
   */
  useSavedShareSource(): Promise<boolean> {
    return ipcRenderer.invoke(IPC.shareUseSaved) as Promise<boolean>;
  },

  onGlobalShortcut(callback: unknown): () => void {
    if (typeof callback !== "function") return () => {};
    const listener = (_event: unknown, action: unknown) => {
      if (typeof action === "string") (callback as (a: string) => void)(action);
    };
    ipcRenderer.on(IPC.shortcutsTriggered, listener);
    return () => {
      ipcRenderer.off(IPC.shortcutsTriggered, listener);
    };
  },

  // Undefined on every machine that cannot do this — anything but Windows
  // 11, and any build shipped without the helper binary. That absence is
  // the website's feature check (see lib/desktopSystemAudio.ts): a bridge
  // that always existed and merely returned false would make the site pay
  // an IPC round trip before every share just to find out.
  systemAudio: hasSystemAudioExclusion()
    ? {
        format: { ...SYSTEM_AUDIO_FORMAT },

        start(): Promise<boolean> {
          return ipcRenderer.invoke(IPC.systemAudioStart);
        },

        stop(): void {
          ipcRenderer.send(IPC.systemAudioStop);
        },

        // One subscription carries both the audio and the end of it, because
        // they are the same thing to the caller: a share that has to keep
        // running either way, with or without sound.
        onData(onChunk: unknown, onEnded: unknown): () => void {
          if (typeof onChunk !== "function") return () => {};
          const data = (_event: unknown, chunk: unknown) => {
            // Electron delivers a Buffer as a Uint8Array here. Checked
            // rather than assumed: this callback is the one place raw bytes
            // from another process reach the page, and passing something
            // unexpected to the worklet would fail deep inside the audio
            // graph instead of here.
            if (chunk instanceof Uint8Array) (onChunk as (c: Uint8Array) => void)(chunk);
          };
          const ended = () => {
            if (typeof onEnded === "function") (onEnded as () => void)();
          };
          ipcRenderer.on(IPC.systemAudioData, data);
          ipcRenderer.on(IPC.systemAudioEnded, ended);
          return () => {
            ipcRenderer.off(IPC.systemAudioData, data);
            ipcRenderer.off(IPC.systemAudioEnded, ended);
          };
        },
      }
    : undefined,
});

// Whether main flagged this machine as capable, through the same argv
// channel readVersion above uses — a sandboxed preload has no other way to
// ask. See SYSTEM_AUDIO_ARG in channels.ts.
function hasSystemAudioExclusion(): boolean {
  return process.argv.includes(SYSTEM_AUDIO_ARG);
}

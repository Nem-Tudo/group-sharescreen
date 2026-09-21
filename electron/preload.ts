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
import { IPC, NATIVE_VIDEO_ARG, SYSTEM_AUDIO_ARG, SYSTEM_AUDIO_FORMAT, VERSION_ARG } from "./channels";

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

  /**
   * Reads or changes the two settings that decide whether this machine can be
   * reached with the window closed — see electron/background.ts.
   *
   * Both resolve to the settings as they stand *after* the change, so the UI
   * renders what the OS actually did rather than what it was asked to do:
   * turning autostart on can fail on a locked-down desktop, and a switch that
   * moved anyway would be lying.
   */
  getBackgroundSettings(): Promise<unknown> {
    return ipcRenderer.invoke(IPC.backgroundGet);
  },

  setBackgroundSettings(patch: unknown): Promise<unknown> {
    if (!patch || typeof patch !== "object") return Promise.resolve(null);
    const next = patch as { runInBackground?: unknown; openAtLogin?: unknown };
    // Re-built rather than forwarded: what crosses the bridge is exactly two
    // booleans, never whatever else the page happened to attach to the object.
    return ipcRenderer.invoke(IPC.backgroundSet, {
      ...(typeof next.runInBackground === "boolean"
        ? { runInBackground: next.runInBackground }
        : {}),
      ...(typeof next.openAtLogin === "boolean" ? { openAtLogin: next.openAtLogin } : {}),
    });
  },

  /**
   * Tells the shell who is calling, so it can flash the taskbar entry — or,
   * when the window is closed to the tray, draw the ring itself in a small
   * window of its own. Sent again with null when the call ends: a window left
   * ringing about a call that is over is worse than one that never opened.
   */
  setCallRinging(call: unknown): void {
    if (!call || typeof call !== "object") {
      ipcRenderer.send(IPC.callRinging, null);
      return;
    }
    // Re-built rather than forwarded, so exactly these three fields cross.
    const value = call as { id?: unknown; name?: unknown; avatarUrl?: unknown };
    if (typeof value.id !== "string" || typeof value.name !== "string") return;
    ipcRenderer.send(IPC.callRinging, {
      id: value.id,
      name: value.name,
      avatarUrl: typeof value.avatarUrl === "string" ? value.avatarUrl : null,
    });
  },

  /**
   * Subscribes to a button pressed in that small window. Returns an
   * unsubscribe function, like onUpdateReady.
   */
  onCallAction(callback: unknown): () => void {
    if (typeof callback !== "function") return () => {};
    const listener = (_event: unknown, payload: unknown) => {
      if (!payload || typeof payload !== "object") return;
      const value = payload as { callId?: unknown; action?: unknown; reason?: unknown };
      if (typeof value.callId !== "string") return;
      if (value.action !== "accept" && value.action !== "decline") return;
      (callback as (a: { callId: string; action: string; reason?: string }) => void)({
        callId: value.callId,
        action: value.action,
        ...(typeof value.reason === "string" ? { reason: value.reason } : {}),
      });
    };
    ipcRenderer.on(IPC.callAction, listener);
    return () => {
      ipcRenderer.off(IPC.callAction, listener);
    };
  },

  /**
   * A notification, drawn by the shell in the corner of the screen rather
   * than handed to the operating system (see toast.html). Re-built rather
   * than forwarded, so exactly these four fields cross.
   */
  showToast(toast: unknown): void {
    if (!toast || typeof toast !== "object") return;
    const value = toast as { id?: unknown; title?: unknown; body?: unknown; icon?: unknown };
    if (typeof value.id !== "string" || typeof value.title !== "string") return;
    ipcRenderer.send(IPC.toastShow, {
      id: value.id,
      title: value.title,
      body: typeof value.body === "string" ? value.body : "",
      icon: typeof value.icon === "string" ? value.icon : null,
    });
  },

  /**
   * Subscribes to "that notification was clicked". The id is the one the page
   * gave showToast, and nothing else comes across. Returns an unsubscribe.
   */
  onToastClick(callback: unknown): () => void {
    if (typeof callback !== "function") return () => {};
    const listener = (_event: unknown, id: unknown) => {
      if (typeof id === "string") (callback as (id: string) => void)(id);
    };
    ipcRenderer.on(IPC.toastClick, listener);
    return () => {
      ipcRenderer.off(IPC.toastClick, listener);
    };
  },

  /**
   * When the bell's newest unread notification arrived, or 0 for none, so the
   * shell can flash the taskbar entry for anything newer than what the window
   * was last open on. Sent on every change.
   */
  setNewestUnreadNotification(at: unknown): void {
    ipcRenderer.send(
      IPC.unreadNotifications,
      typeof at === "number" && Number.isFinite(at) && at > 0 ? at : 0
    );
  },

  /**
   * Whether the window is minimised or closed to the tray, now and on every
   * change — see IPC.windowBackground for why the page cannot just read
   * document.visibilityState. The callback gets the current state first, then
   * each change. Returns an unsubscribe.
   */
  onWindowBackground(callback: unknown): () => void {
    if (typeof callback !== "function") return () => {};
    const emit = callback as (background: boolean) => void;
    let active = true;
    const listener = (_event: unknown, background: unknown) => {
      if (typeof background === "boolean") emit(background);
    };
    ipcRenderer.on(IPC.windowBackground, listener);
    void ipcRenderer.invoke(IPC.windowBackgroundGet).then((background: unknown) => {
      if (active && typeof background === "boolean") emit(background);
    });
    return () => {
      active = false;
      ipcRenderer.off(IPC.windowBackground, listener);
    };
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

  /**
   * The push-to-talk key, as an accelerator — "" turns it off. Separate from
   * setGlobalShortcuts because this key is not an action that fires: the
   * shell follows it down and up (see main.ts's push-to-talk section).
   */
  setPushToTalk(accelerator: unknown): void {
    ipcRenderer.send(IPC.pushToTalkSet, typeof accelerator === "string" ? accelerator : "");
  },

  onPushToTalk(callback: unknown): () => void {
    if (typeof callback !== "function") return () => {};
    const listener = (_event: unknown, held: unknown) => {
      if (typeof held === "boolean") (callback as (h: boolean) => void)(held);
    };
    ipcRenderer.on(IPC.pushToTalkState, listener);
    return () => {
      ipcRenderer.off(IPC.pushToTalkState, listener);
    };
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

  // The GPU screen capture (see electron/nativeVideo.ts and
  // lib/nativeVideoCapture.ts). Absent unless the helper shipped with this
  // build; whether the machine can run it is what probe() answers.
  nativeVideo: process.argv.includes(NATIVE_VIDEO_ARG)
    ? {
        probe(): Promise<{ supported: boolean; encoder: string | null }> {
          return ipcRenderer.invoke(IPC.nativeVideoProbe);
        },

        start(options: unknown): Promise<unknown> {
          return ipcRenderer.invoke(IPC.nativeVideoStart, options);
        },

        // Whether a share from this page would be captured here at all. The
        // picker reads it to decide whether to offer "não mostrar estas
        // janelas", which only this capture can honour — see
        // IPC.nativeVideoIntent.
        setIntent(wanted: unknown): void {
          ipcRenderer.send(IPC.nativeVideoIntent, wanted === true);
        },

        control(command: unknown): void {
          if (!command || typeof command !== "object") return;
          const { bitrateKbps, keyFrame } = command as { bitrateKbps?: unknown; keyFrame?: unknown };
          ipcRenderer.send(IPC.nativeVideoControl, {
            bitrateKbps: typeof bitrateKbps === "number" ? bitrateKbps : undefined,
            keyFrame: keyFrame === true,
          });
        },

        stop(): void {
          ipcRenderer.send(IPC.nativeVideoStop);
        },

        onFrame(onFrame: unknown, onEnded: unknown): () => void {
          if (typeof onFrame !== "function") return () => {};
          const frame = (_event: unknown, meta: unknown, data: unknown) => {
            if (!meta || typeof meta !== "object" || !(data instanceof Uint8Array)) return;
            const m = meta as Record<string, unknown>;
            (onFrame as (meta: unknown, data: Uint8Array) => void)(
              {
                key: m.key === true,
                sequence: Number(m.sequence) || 0,
                width: Number(m.width) || 0,
                height: Number(m.height) || 0,
                timeMs: Number(m.timeMs) || 0,
              },
              data
            );
          };
          const ended = (_event: unknown, reason: unknown) => {
            if (typeof onEnded === "function") {
              (onEnded as (reason: string) => void)(reason === "target-gone" ? "target-gone" : "failed");
            }
          };
          ipcRenderer.on(IPC.nativeVideoFrame, frame);
          ipcRenderer.on(IPC.nativeVideoEnded, ended);
          return () => {
            ipcRenderer.off(IPC.nativeVideoFrame, frame);
            ipcRenderer.off(IPC.nativeVideoEnded, ended);
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

// Bridge for the corner notification window (see toast.html).
//
// Its own preload for the same reason the ringing window has one: a different
// window with a different job, and the surface it may reach is exactly what it
// needs — "what am I showing", "show this instead", and "this is what
// happened to it". No session, no socket, no way to act on anything: a click
// is reported to main, which brings the app up and hands the click to the page.

import { contextBridge, ipcRenderer } from "electron";
import { IPC, type ToastAction, type ToastWindowData } from "./channels";

contextBridge.exposeInMainWorld("goliveToast", {
  data(): Promise<ToastWindowData | null> {
    return ipcRenderer.invoke(IPC.toastData);
  },

  /** Subscribes to "a newer notification replaces this one". Returns an unsubscribe. */
  onUpdate(callback: (data: ToastWindowData) => void): () => void {
    const listener = (_event: unknown, data: unknown) => {
      if (data && typeof data === "object") callback(data as ToastWindowData);
    };
    ipcRenderer.on(IPC.toastUpdate, listener);
    return () => {
      ipcRenderer.off(IPC.toastUpdate, listener);
    };
  },

  act(action: ToastAction): void {
    // Rebuilt rather than forwarded — the two fields of the contract, nothing else.
    if (typeof action?.id !== "string") return;
    ipcRenderer.send(IPC.toastAction, {
      action: action.action === "click" ? "click" : "dismiss",
      id: action.id,
    });
  },
});

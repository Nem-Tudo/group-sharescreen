// Bridge for the "Desenhar na tela" windows (screen-pen.html, the canvas, and
// screen-pen-toolbar.html). Their own preload, like the toast's: what they may
// reach is exactly "what am I drawing with", "this changed" and "this was
// pressed". No session, no socket — main decides everything.

import { contextBridge, ipcRenderer } from "electron";
import { IPC, type ScreenPenCanvasInfo, type ScreenPenCommand, type ScreenPenState } from "./channels";

contextBridge.exposeInMainWorld("goliveScreenPen", {
  state(): Promise<ScreenPenState | null> {
    return ipcRenderer.invoke(IPC.screenPenState);
  },

  onUpdate(callback: (state: ScreenPenState) => void): () => void {
    const listener = (_event: unknown, state: unknown) => {
      if (state && typeof state === "object") callback(state as ScreenPenState);
    };
    ipcRenderer.on(IPC.screenPenUpdate, listener);
    return () => {
      ipcRenderer.off(IPC.screenPenUpdate, listener);
    };
  },

  /** Canvas only: undo / redo / clear pressed on the toolbar. */
  onCommand(callback: (command: string) => void): () => void {
    const listener = (_event: unknown, command: unknown) => {
      if (typeof command === "string") callback(command);
    };
    ipcRenderer.on(IPC.screenPenCanvasCommand, listener);
    return () => {
      ipcRenderer.off(IPC.screenPenCanvasCommand, listener);
    };
  },

  command(command: ScreenPenCommand): void {
    if (command && typeof command === "object") ipcRenderer.send(IPC.screenPenCommand, { ...command });
  },

  /** Canvas only: how many marks it holds, and whether one was just added. */
  info(info: ScreenPenCanvasInfo & { added?: boolean }): void {
    ipcRenderer.send(IPC.screenPenCanvasInfo, {
      marks: Number(info?.marks) || 0,
      canUndo: info?.canUndo === true,
      canRedo: info?.canRedo === true,
      added: info?.added === true,
    });
  },
});

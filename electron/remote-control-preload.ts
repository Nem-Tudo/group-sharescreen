// Bridge for the remote control windows (see remote-control.html): the
// "Permitir / Recusar" prompt and the "Parar" banner.
//
// Two calls, nothing else: what to show, and which button was pressed. No
// session, no socket, no way to reach the page — the answer goes to main,
// which is the only side that can start golive-input. And the words on the
// buttons live in the HTML, not in anything handed over here, so a page that
// asks for a session cannot also decide what "Permitir" says.

import { contextBridge, ipcRenderer } from "electron";
import { IPC, type RemoteControlWindowData } from "./channels";

contextBridge.exposeInMainWorld("goliveRemoteControl", {
  data(): Promise<RemoteControlWindowData | null> {
    return ipcRenderer.invoke(IPC.remoteControlWindowData);
  },
  // "allow" carries the boxes ticked in the prompt; "perm" is one switch on
  // the banner during the session. Rebuilt from booleans only, so nothing else
  // the window attached crosses over; main reads it all again anyway.
  choose(
    choice: "allow" | "decline" | "block-hour" | "block-forever" | "stop" | "perm",
    extra?: { perms?: Record<string, unknown>; key?: string; on?: boolean }
  ): void {
    if (!["allow", "decline", "block-hour", "block-forever", "stop", "perm"].includes(choice)) return;
    const message: Record<string, unknown> = { choice };
    if (choice === "allow" && extra?.perms && typeof extra.perms === "object") {
      const perms: Record<string, boolean> = {};
      for (const key of ["mouse", "keyboard", "clipboard", "app", "lockOnEnd"]) {
        if (typeof extra.perms[key] === "boolean") perms[key] = extra.perms[key] as boolean;
      }
      message.perms = perms;
    }
    if (choice === "perm" && typeof extra?.key === "string") {
      message.key = extra.key;
      message.on = extra.on === true;
    }
    ipcRenderer.send(IPC.remoteControlWindowChoose, message);
  },
});

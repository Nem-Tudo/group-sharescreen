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
  choose(choice: "allow" | "decline" | "stop"): void {
    if (choice === "allow" || choice === "decline" || choice === "stop") {
      ipcRenderer.send(IPC.remoteControlWindowChoose, choice);
    }
  },
});

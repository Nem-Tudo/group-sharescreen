// Bridge for the screen picker window (see picker.html).
//
// Separate from the main preload because it is handed to a different window
// with a different job: this one may read the source list and the list of
// applications making sound, and nothing else. The main window's bridge
// deliberately has no access to either — between them they contain the title
// of every open window and the name of every program running on the machine,
// which is a meaningful amount of information about the user, and the website
// loaded in that window has no business seeing it.

import { contextBridge, ipcRenderer } from "electron";
import {
  IPC,
  type PickerAudioApp,
  type PickerChoice,
  type PickerData,
  type PickerHiddenApp,
} from "./channels";

contextBridge.exposeInMainWorld("picker", {
  list(): Promise<PickerData> {
    return ipcRenderer.invoke(IPC.pickerList);
  },
  // Asked for when the settings panel is opened rather than up front — see
  // IPC.pickerAudioApps for why it is not part of list().
  audioApps(): Promise<PickerAudioApp[]> {
    return ipcRenderer.invoke(IPC.pickerAudioApps);
  },
  // Likewise on opening the "não mostrar estas janelas" panel, and likewise
  // not before: it reads an icon out of every open application.
  hiddenApps(): Promise<PickerHiddenApp[]> {
    return ipcRenderer.invoke(IPC.pickerHiddenApps);
  },
  choose(choice: PickerChoice): void {
    ipcRenderer.send(IPC.pickerChoose, choice);
  },
});

// NVIDIA on NixOS: lets the driver find its EGL external platform configs.
//
// The NVIDIA EGL driver looks for them in the usual FHS directories, and NixOS
// keeps them under /run/opengl-driver instead. An AppImage has no wrapper to
// fix that up, so EGL falls through to Mesa, which has no driver for the card:
// "egl: failed to create dri2 screen" (issue #44).
//
// Setting process.env alone is not enough. The variable has to be there when
// the GPU process starts, and Chromium forks its zygote before any of our code
// runs, so a child forked from it would not see the change. Hence the re-exec:
// the same process image starts over with the variable in place from the very
// first instruction. execve rather than app.relaunch() because it keeps the
// PID, and the AppImage runtime unmounts the image as soon as its child exits.
//
// Everywhere else this does nothing: the directory does not exist on other
// distributions, and a value the person set themselves is left alone, which
// also means the restarted process cannot loop. This module must be main.ts's
// first import, so the restart happens before anything else has run.

import fs from "node:fs";

const ENV_VAR = "__EGL_EXTERNAL_PLATFORM_CONFIG_DIRS";
const NIXOS_DIR = "/run/opengl-driver/share/egl/egl_external_platform.d";

function hasConfigs(dir: string): boolean {
  try {
    return fs.readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

if (process.platform === "linux" && !process.env[ENV_VAR] && hasConfigs(NIXOS_DIR)) {
  process.env[ENV_VAR] = NIXOS_DIR;
  try {
    // Not in the installed @types/node yet; Electron 38's Node 22 has it.
    const { execve } = process as unknown as {
      execve: (file: string, args: string[], env: NodeJS.ProcessEnv) => never;
    };
    execve(process.execPath, process.argv, process.env);
  } catch (error) {
    // Starting normally is what happened before this file existed.
    console.warn("[linuxEgl] restart failed", error);
  }
}

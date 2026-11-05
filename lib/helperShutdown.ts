// Ending a capture helper (golive-audiocap, or parec on Linux).
//
// Lives here rather than in electron/systemAudio.ts so it can be tested
// without Electron: it only needs the few members of a ChildProcess below.

/** The parts of a ChildProcess this touches. */
export interface HelperProcess {
  readonly stdin: { end(): unknown };
  readonly killed: boolean;
  kill(): boolean;
  once(event: "exit", listener: () => void): unknown;
}

// How long a helper that heard the stdin signal gets to stop its audio client
// properly before it is killed anyway.
export const HELPER_FORCE_KILL_MS = 1000;

/**
 * Ends a helper.
 *
 * `listening` is whether the helper is reading its stdin, which is the only
 * case in which closing it means anything. golive-audiocap starts that watch
 * only after it prints READY (see wmain in electron/native/src/audiocap.cpp),
 * so before then, while activation is still running or wedged, the close goes
 * unheard. parec never reads stdin at all. Those are killed straight away.
 *
 * The backstop alone does not cover them on a quit: its timer is unref'd so it
 * cannot hold up the quit, which also means it never fires on one. A helper
 * that is listening still exits once the app is gone, because its stdin
 * breaks. One that is not has nothing left to end it, and Windows does not end
 * a child when its parent exits.
 */
export function endHelper(child: HelperProcess, listening: boolean) {
  if (!listening) {
    child.kill();
    return;
  }
  // Closing stdin is the helper's documented shutdown signal (see its
  // WatchStdin): it stops the audio client properly and exits on its own.
  // kill() is the backstop for a helper that is already wedged, not the
  // first resort: terminating it outright leaves WASAPI to clean up after
  // the fact.
  try {
    child.stdin.end();
  } catch {
    // Already closed. The exit handler has this covered.
  }
  const forceKill = setTimeout(() => {
    if (!child.killed) child.kill();
  }, HELPER_FORCE_KILL_MS);
  // Node keeps the process alive for a pending timer, and a one-second delay
  // on quit is a visible hang.
  forceKill.unref?.();
  child.once("exit", () => clearTimeout(forceKill));
}

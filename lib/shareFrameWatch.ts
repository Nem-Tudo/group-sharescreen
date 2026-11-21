// A screen share whose capture never produces a picture.
//
// On some Windows machines every capture path returns zero frames: Chromium's
// own (DXGI / WGC) and, when it is tried, the GPU helper's too. getDisplayMedia
// still resolves, the track is "live", the peers connect — and the share is a
// black tile with a spinner, for the person sharing as much as for the room,
// with nothing anywhere saying so. The own-stream panel reads "Capturando:
// aguardando…" and 0 fps forever.
//
// This module only answers "did a frame ever come out of this track". What to
// do about it (try the helper with another method, tell the person) lives in
// useRoomMedia's screen capture, behind the experiment below.

/** The experiment: "on" rescues and warns; control only measures. */
export const SHARE_NO_FRAMES_FEATURE = "share-no-frames";

// Short on purpose — the API refuses anything over 40 characters.
export const SHARE_NO_FRAMES_EVENTS = {
  /** The browser's capture gave no frame within the wait. */
  noFrames: "share_no_frames",
  /** Same, split by what was shared. */
  noFramesScreen: "share_no_frames.screen",
  noFramesWindow: "share_no_frames.window",
  /** The GPU helper stepped in and did produce frames. */
  rescued: "share_no_frames_rescued",
  /** Nothing worked: the warning was shown. */
  failed: "share_no_frames_failed",
  /** Frames did come, after the wait (a false alarm, or a slow start). */
  late: "share_no_frames_late",
} as const;

/** How long a capture may stay silent before it counts as producing nothing. */
export const FIRST_FRAME_WAIT_MS = 4000;

const POLL_MS = 100;

interface TrackWithStats extends MediaStreamTrack {
  stats?: { totalFrames?: number; deliveredFrames?: number };
}

function framesFromStats(track: MediaStreamTrack): number | null {
  const stats = (track as TrackWithStats).stats;
  if (!stats) return null;
  const total = stats.totalFrames ?? stats.deliveredFrames;
  return typeof total === "number" ? total : null;
}

/**
 * Resolves true on the track's first frame, false when `timeoutMs` passes
 * without one (or the track ends first), null when this browser has no way
 * to tell — in which case the caller must assume the share is fine.
 *
 * Two signals, whichever comes first. A detached, muted <video> playing the
 * track: it reaches "loadeddata" on the first decoded frame, and it is also
 * the sink that guarantees the source is delivering at all (this runs before
 * the share's own preview exists). And MediaStreamTrack.stats (Chromium 121+),
 * which can answer sooner than the element does.
 */
export function waitForFirstFrame(track: MediaStreamTrack, timeoutMs: number): Promise<boolean | null> {
  if (track.readyState === "ended") return Promise.resolve(false);
  if (typeof document === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    let done = false;
    let poll: ReturnType<typeof setTimeout> | null = null;
    const finish = (value: boolean | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (poll) clearTimeout(poll);
      track.removeEventListener("ended", onEnded);
      video.removeEventListener("loadeddata", onData);
      video.pause();
      video.srcObject = null;
      resolve(value);
    };
    const onEnded = () => finish(false);
    const onData = () => {
      if (video.videoWidth > 0) finish(true);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    const checkStats = () => {
      poll = null;
      if (done) return;
      if (track.readyState === "ended") return finish(false);
      const frames = framesFromStats(track);
      if (frames !== null && frames > 0) return finish(true);
      poll = setTimeout(checkStats, POLL_MS);
    };
    track.addEventListener("ended", onEnded);
    video.addEventListener("loadeddata", onData);
    video.srcObject = new MediaStream([track]);
    void video.play().catch(() => {
      // Refused to play: the element cannot answer, the stats may still.
      if (framesFromStats(track) === null) finish(null);
    });
    checkStats();
  });
}

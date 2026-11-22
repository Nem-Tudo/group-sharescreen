// What the page around a video connection is doing, for quality telemetry
// and for the "Travou?" button (lib/stallReport).
//
// The connection's stats say what arrived and what was decoded. They cannot
// say whether the frames were then painted, whether our own page held the
// main thread, or whether the machine was buried under something else (a
// game, usually). The 2026-11-22 read of production had 82% of viewers under
// 15 fps watching a sender under 15 fps whose capture itself delivered few
// frames — and no way to tell a still screen from a starved machine. This is
// what tells them apart:
//
//   - long tasks on the main thread (PerformanceObserver "longtask");
//   - Compute Pressure on the CPU (PressureObserver, Chromium);
//   - frames each remote tile really presented (requestVideoFrameCallback).
//
// All three are cheap: the observers are passive and the frame callback is a
// counter. Totals only grow; whoever reads them keeps its own last value and
// takes the difference. A per-second history of the last minute stays in
// memory for the stall report, never sent unless somebody presses the button.

const HISTORY_S = 60;

type PressureState = "nominal" | "fair" | "serious" | "critical";

interface SecondSlot {
  /** Unix second this slot belongs to. */
  at: number;
  longTaskMs: number;
  /** Worst pressure seen during the second; null where unknown. */
  pressure: PressureState | null;
}

let started = false;
let longTaskTotalMs = 0;
let longTaskKnown = false;
let pressureState: PressureState | null = null;
const seconds: SecondSlot[] = [];

const PRESSURE_RANK: Record<PressureState, number> = { nominal: 0, fair: 1, serious: 2, critical: 3 };

function slotNow(): SecondSlot {
  const at = Math.floor(Date.now() / 1000);
  const last = seconds[seconds.length - 1];
  if (last && last.at === at) return last;
  const slot: SecondSlot = { at, longTaskMs: 0, pressure: pressureState };
  seconds.push(slot);
  while (seconds.length > HISTORY_S) seconds.shift();
  return slot;
}

/** Starts the observers. Idempotent; a no-op on the server or where nothing is supported. */
export function startPageHealth() {
  if (started || typeof window === "undefined") return;
  started = true;
  try {
    const types = (PerformanceObserver as unknown as { supportedEntryTypes?: readonly string[] }).supportedEntryTypes ?? [];
    if (types.includes("longtask")) {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTaskTotalMs += entry.duration;
          slotNow().longTaskMs += entry.duration;
        }
      });
      observer.observe({ type: "longtask", buffered: false });
      longTaskKnown = true;
    }
  } catch {
    longTaskKnown = false;
  }
  const Ctor = (globalThis as unknown as {
    PressureObserver?: new (cb: (records: { state: PressureState }[]) => void) => {
      observe(source: string, options?: { sampleInterval?: number }): Promise<void>;
    };
  }).PressureObserver;
  if (Ctor) {
    try {
      const observer = new Ctor((records) => {
        const last = records[records.length - 1];
        if (!last) return;
        pressureState = last.state;
        const slot = slotNow();
        if (slot.pressure === null || PRESSURE_RANK[last.state] > PRESSURE_RANK[slot.pressure]) slot.pressure = last.state;
      });
      void observer.observe("cpu", { sampleInterval: 1000 }).catch(() => {
        pressureState = null;
      });
    } catch {
      pressureState = null;
    }
  }
}

/** Milliseconds of long tasks since the page began; null where the browser does not report them. */
export function longTaskTotal(): number | null {
  return longTaskKnown ? longTaskTotalMs : null;
}

/** Whether the CPU is under "serious" or "critical" pressure now; null where unknown. */
export function cpuBusyNow(): boolean | null {
  return pressureState === null ? null : PRESSURE_RANK[pressureState] >= 2;
}

// ---------------------------------------------------------------------------
// Presented frames, per remote picture

interface FrameWatcher {
  video: HTMLVideoElement;
  /** Frames presented, from the element's own presentedFrames counter (callbacks can be skipped). */
  lastPresented: number | null;
}

interface PictureFrames {
  watchers: FrameWatcher[];
  total: number;
  /** Per-second presented counts and the longest gap between two frames in that second, ms. */
  history: { at: number; frames: number; maxGapMs: number }[];
  lastFrameAt: number | null;
}

const pictures = new Map<string, PictureFrames>();

const pictureKey = (channel: string, originId: string) => `${channel} ${originId}`;

type FrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: { presentedFrames: number }) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

/**
 * Counts the frames `video` presents, as the picture of (channel, originId).
 * Two tiles of the same picture (a spotlight and its strip) count once: only
 * the first one still mounted does. Returns the cleanup.
 */
export function watchPresentedFrames(video: HTMLVideoElement, channel: string, originId: string): () => void {
  const el = video as FrameCallbackVideo;
  if (typeof el.requestVideoFrameCallback !== "function") return () => {};
  const key = pictureKey(channel, originId);
  let picture = pictures.get(key);
  if (!picture) {
    picture = { watchers: [], total: 0, history: [], lastFrameAt: null };
    pictures.set(key, picture);
  }
  const entry: FrameWatcher = { video, lastPresented: null };
  picture.watchers.push(entry);
  const own = picture;
  let handle = 0;
  let stopped = false;
  const onFrame = (_now: number, meta: { presentedFrames: number }) => {
    if (stopped) return;
    if (own.watchers[0] === entry) {
      const added = entry.lastPresented === null ? 1 : Math.max(0, meta.presentedFrames - entry.lastPresented);
      own.total += added;
      const nowMs = Date.now();
      const at = Math.floor(nowMs / 1000);
      let slot = own.history[own.history.length - 1];
      if (!slot || slot.at !== at) {
        slot = { at, frames: 0, maxGapMs: 0 };
        own.history.push(slot);
        while (own.history.length > HISTORY_S) own.history.shift();
      }
      slot.frames += added;
      if (own.lastFrameAt !== null) slot.maxGapMs = Math.max(slot.maxGapMs, nowMs - own.lastFrameAt);
      own.lastFrameAt = nowMs;
    }
    entry.lastPresented = meta.presentedFrames;
    handle = el.requestVideoFrameCallback!(onFrame);
  };
  handle = el.requestVideoFrameCallback(onFrame);
  return () => {
    stopped = true;
    el.cancelVideoFrameCallback?.(handle);
    const index = own.watchers.indexOf(entry);
    if (index >= 0) own.watchers.splice(index, 1);
    // The next tile's counter starts from where its element is, not from zero.
    if (index === 0 && own.watchers[0]) own.watchers[0].lastPresented = null;
    if (own.watchers.length === 0) pictures.delete(key);
  };
}

/** Frames presented so far for this picture; null when no tile is counting it. */
export function presentedTotal(channel: string, originId: string): number | null {
  const picture = pictures.get(pictureKey(channel, originId));
  return picture ? picture.total : null;
}

export interface PageHistorySecond {
  /** Seconds before the snapshot (0 = the current second). */
  ago: number;
  longTaskMs: number;
  pressure: PressureState | null;
  /** Frames the picture's tile presented that second; null when no tile was counting it. */
  frames: number | null;
  /** Longest wait between two presented frames ending that second, ms. */
  maxGapMs: number | null;
}

/** The last minute, second by second, for one picture. Oldest first. */
export function pageHistory(channel: string, originId: string): PageHistorySecond[] {
  const now = Math.floor(Date.now() / 1000);
  const picture = pictures.get(pictureKey(channel, originId));
  const frames = new Map(picture?.history.map((s) => [s.at, s]) ?? []);
  const page = new Map(seconds.map((s) => [s.at, s]));
  const out: PageHistorySecond[] = [];
  for (let ago = HISTORY_S - 1; ago >= 0; ago -= 1) {
    const at = now - ago;
    const p = page.get(at);
    const f = frames.get(at);
    out.push({
      ago,
      longTaskMs: Math.round(p?.longTaskMs ?? 0),
      pressure: p?.pressure ?? pressureState,
      frames: picture ? f?.frames ?? 0 : null,
      maxGapMs: f ? Math.round(f.maxGapMs) : null,
    });
  }
  return out;
}

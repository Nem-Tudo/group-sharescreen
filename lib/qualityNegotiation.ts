// Viewer -> broadcaster quality requests.
//
// In a 30-person room the grid gives each tile roughly 320x216 CSS pixels, so
// shipping 1080p to it throws away about 95% of the encoded pixels, on the
// broadcaster's CPU as much as on their uplink. Each viewer says what its tile
// actually needs, and a viewer who is not looking at all says so too, which
// stops that one encoder entirely.
//
// Two rules decide when a request goes out, and they lean the same way: towards
// the picture being sharp.
//
//   - Asking for more is immediate. A tile that grew is showing a stretched
//     picture right now, every moment of which is visible.
//   - Asking for less waits (DOWNGRADE_HOLD_MS). A tile that shrank has more
//     pixels than it needs, which nobody can see, and tiles shrink for a moment
//     all the time: a panel opening, a window being dragged, a grid reflowing.
//     Waiting costs a few seconds of a larger encode and saves a pair of
//     keyframes every time the layout comes back.
//
// It rides the existing signalling relay: the server forwards a "signal"
// message's `data` payload opaquely, so a new field travels end to end without
// a backend change, and a broadcaster running older code reads the tier and
// ignores the rest.

import type { ExtraCameraSlot } from "./multiCamera";
import type { ExtraScreenSlot } from "./multiScreen";
import { signalingClient } from "./signalingClient";
import { isStreamRetained, onStreamUseChange } from "./streamUse";
import { tierForRenderedSize, tierIndex, MAX_TIER_FPS, WORST_TIER, stepDownUnder, type QualityTier } from "./videoQuality";

// The video channels a viewer can ask for a size on. The "fileN" ones are
// local files being played into the room (see lib/localMediaSource.ts) — a
// channel each, precisely so several can run at once and alongside a screen
// share, and each wants the same per-viewer downscaling as the other two.
// "screen2".."screen10" are the extra screens of "Várias telas" (see
// lib/multiScreen.ts), for the same reason, and "camera3".."camera10" the
// extra cameras of "Várias câmeras" (see lib/multiCamera.ts).
export type QualityChannel =
  | "screen"
  | "camera"
  | "camera2"
  | "file1"
  | "file2"
  | "file3"
  | ExtraScreenSlot
  | ExtraCameraSlot;

interface Entry {
  channel: QualityChannel;
  peerId: string;
  width: number;
  height: number;
  /** What the broadcaster was last told. */
  tier: QualityTier | null;
  idle: boolean;
  lastSentAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  /** Whether this tile is on screen in a page somebody is looking at. */
  hidden: boolean;
  /** When the tile went out of sight; null while it is in sight. */
  hiddenSince: number | null;
  /** When the size-based answer first came out lower than what is being asked for. */
  shrunkSince: number | null;
  /** The stream behind this tile, to ask whether anything else is using it. */
  stream: MediaStream | null;
  /** Tiers below the size-based one, while our decoder cannot keep up. */
  dropSteps: number;
  dropStrikes: number;
  cleanSince: number | null;
  /** How long a clean stretch must last to step back up; doubles on every relapse. */
  dropRecoverMs: number;
  /** Whether this tile has stepped back up before, so a new step down is a relapse. */
  dropRecovered: boolean;
}

// Two telemetry samples in a row (~20 s) dropping a tenth of the frames, with
// the decoder busy at least DROP_DECODE_LOAD of the time, step a tile down; a
// clean minute steps it back. Two steps at most: past that the decoder is not
// the only thing wrong, and the picture would be too small to be worth the
// trade.
//
// The load test is what keeps the network out of it: frames lost or late on
// the way in are dropped too, by a decoder with nothing much to do, and a
// smaller picture fixes none of that. A browser that does not report decode
// time never steps — a cut nobody can show is needed is not made.
const DROP_STEP_SHARE = 0.1;
const DROP_DECODE_LOAD = 0.5;
const DROP_CLEAN_SHARE = 0.03;
const DROP_STRIKES = 2;
const DROP_RECOVER_MS = 60_000;
// A tile that steps back up only to drop again waits twice as long each time
// before trying once more, up to this: otherwise a decoder that copes at one
// size and not the next would trade sizes every minute and a half for good.
const DROP_RECOVER_MAX_MS = 8 * 60_000;
const MAX_DROP_STEPS = 2;

// A dragged window or an animated grid transition fires ResizeObserver
// continuously; this keeps it to one request for the final size.
const UPGRADE_COALESCE_MS = 120;
// How long a tile must stay smaller before the broadcaster is told. See the
// head of the file.
const DOWNGRADE_HOLD_MS = 6000;
// How long a tile must stay out of sight before its encoder is stopped. Long
// enough for an alt-tab and back to cost nothing at all.
const IDLE_AFTER_MS = 8000;
// A request to resume is the one message whose loss is visible, and the socket
// drops what it cannot send while reconnecting: it goes again shortly after.
const RESUME_RESEND_MS = [1500, 5000];
// Re-announce periodically even when nothing changed, so a broadcaster that
// reconnected (new sendPC, fresh default tier) converges without needing a
// separate handshake.
const REFRESH_MS = 20_000;

class QualityNegotiator {
  private entries = new Map<string, Entry>();
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private watchingUse = false;

  private key(channel: string, peerId: string) {
    return `${channel}:${peerId}`;
  }

  private entryFor(channel: QualityChannel, peerId: string): Entry {
    const key = this.key(channel, peerId);
    let entry = this.entries.get(key);
    if (entry) return entry;
    entry = {
      channel,
      peerId,
      width: 0,
      height: 0,
      tier: null,
      idle: false,
      lastSentAt: 0,
      timer: null,
      hidden: false,
      hiddenSince: null,
      shrunkSince: null,
      stream: null,
      dropSteps: 0,
      dropStrikes: 0,
      cleanSince: null,
      dropRecoverMs: DROP_RECOVER_MS,
      dropRecovered: false,
    };
    this.entries.set(key, entry);
    this.ensureRefresh();
    if (!this.watchingUse) {
      this.watchingUse = true;
      // Something started or stopped using a stream: what a hidden tile should
      // ask for may have changed.
      onStreamUseChange(() => {
        for (const e of this.entries.values()) if (e.hidden) this.evaluate(e);
      });
    }
    return entry;
  }

  /**
   * Report the size a peer's video is currently rendered at, in CSS pixels.
   * Cheap to call on every ResizeObserver tick.
   */
  report(channel: QualityChannel, peerId: string, width: number, height: number) {
    // A tile that is not laid out yet (0x0, hidden tab, display:none) tells
    // us nothing. Reporting it would pin the peer to the worst tier and it
    // would stay pinned once the tile became visible again.
    if (width <= 0 || height <= 0) return;
    const entry = this.entryFor(channel, peerId);
    entry.width = width;
    entry.height = height;
    this.evaluate(entry);
  }

  /**
   * Say whether this peer's tile is on screen at all. A viewer that cannot see
   * a tile has no use for its frames, and saying so is worth far more to the
   * broadcaster than to us: one encoder less, on the machine that is already
   * the bottleneck in a mesh room.
   */
  setHidden(channel: QualityChannel, peerId: string, hidden: boolean) {
    const entry = this.entries.get(this.key(channel, peerId));
    // Nothing to say about a tile that has never reported a size: there is no
    // standing request to walk back.
    if (!entry || entry.hidden === hidden) return;
    entry.hidden = hidden;
    entry.hiddenSince = hidden ? Date.now() : null;
    this.evaluate(entry);
  }

  /** The stream this tile shows, so that other uses of it can keep it coming. */
  bindStream(channel: QualityChannel, peerId: string, stream: MediaStream | null) {
    const entry = this.entries.get(this.key(channel, peerId));
    if (entry) entry.stream = stream;
    else if (stream) this.entryFor(channel, peerId).stream = stream;
  }

  private sizedTier(entry: Entry): QualityTier | null {
    if (entry.width <= 0) return null;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio : 1;
    // MAX_TIER_FPS: tile size decides pixels, never frames, so the request asks
    // for the fastest rung at that size and the broadcaster's fps dial caps it.
    const sized = tierForRenderedSize(entry.width, entry.height, dpr, MAX_TIER_FPS);
    return entry.dropSteps > 0 ? stepDownUnder(sized, entry.dropSteps) : sized;
  }

  // What this tile should be asking for right now, and when that next changes.
  private evaluate(entry: Entry, force = false) {
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    const sized = this.sizedTier(entry);
    if (!sized) return;
    const now = Date.now();
    const inUse = isStreamRetained(entry.stream);

    if (entry.hidden && !inUse) {
      const left = (entry.hiddenSince ?? now) + IDLE_AFTER_MS - now;
      if (left <= 0) {
        this.apply(entry, WORST_TIER, true, force);
        return;
      }
      // Out of sight, but not for long enough to give the picture up.
      entry.timer = setTimeout(() => this.evaluate(entry), left);
      // Forced inside the wait: repeat what is standing.
      if (force) this.apply(entry, entry.tier ?? sized, entry.idle, true);
      return;
    }

    // In sight, or in use by something that needs the frames just the same.
    const current = entry.tier;
    const lower = current !== null && !entry.idle && tierIndex(sized) > tierIndex(current);
    if (!lower) {
      entry.shrunkSince = null;
      const wait = force || entry.idle || current === null ? 0 : tierIndex(sized) < tierIndex(current) ? UPGRADE_COALESCE_MS : 0;
      if (wait > 0) {
        entry.timer = setTimeout(() => {
          entry.timer = null;
          const latest = this.sizedTier(entry);
          if (latest) this.apply(entry, latest, false, false);
        }, wait);
        return;
      }
      this.apply(entry, sized, false, force);
      return;
    }
    // Smaller than what is being asked for. See DOWNGRADE_HOLD_MS.
    entry.shrunkSince ??= now;
    const left = entry.shrunkSince + DOWNGRADE_HOLD_MS - now;
    if (left > 0) {
      entry.timer = setTimeout(() => this.evaluate(entry), left);
      // Forced inside the wait: repeat what is standing.
      if (force) this.apply(entry, current, false, true);
      return;
    }
    entry.shrunkSince = null;
    this.apply(entry, sized, false, force);
  }

  private apply(entry: Entry, tier: QualityTier, idle: boolean, force: boolean) {
    if (!force && tier === entry.tier && idle === entry.idle) return;
    const resuming = entry.idle && !idle;
    entry.tier = tier;
    entry.idle = idle;
    this.send(entry);
    if (!resuming) return;
    for (const delay of RESUME_RESEND_MS) {
      setTimeout(() => {
        if (this.entries.get(this.key(entry.channel, entry.peerId)) === entry && !entry.idle) this.send(entry);
      }, delay);
    }
  }

  private send(entry: Entry) {
    if (!entry.tier) return;
    entry.lastSentAt = Date.now();
    signalingClient.sendSignal(entry.peerId, {
      channel: entry.channel,
      role: "viewer",
      kind: "quality",
      tier: entry.tier,
      ...(entry.idle ? { idle: true } : {}),
    });
  }

  /**
   * Force this peer to be told our current request again — used when a fresh
   * stream arrives from them, since that means a brand new sender on their
   * side that has never heard it.
   */
  announce(channel: QualityChannel, peerId: string) {
    const entry = this.entries.get(this.key(channel, peerId));
    if (!entry || entry.width <= 0) return;
    this.evaluate(entry, true);
  }

  /**
   * Whether this peer's tile is on screen in a page somebody is looking at;
   * null when the tile has never reported (a channel without one). For the
   * connection-quality reports — see connectionTelemetrySummary's
   * MIN_VISIBLE_SHARE.
   */
  isVisible(channel: string, peerId: string): boolean | null {
    const entry = this.entries.get(this.key(channel, peerId));
    if (!entry || entry.width <= 0) return null;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return false;
    return !entry.hidden;
  }

  /** Whether we have asked this peer to stop sending for now. */
  isIdle(channel: string, peerId: string): boolean {
    return this.entries.get(this.key(channel, peerId))?.idle === true;
  }

  /**
   * One telemetry sample of this tile's decoder: the share of received frames
   * it dropped, and how busy it was (see RecvVideoStats.decodeLoad). Steps the
   * tile's request down while both stay high, and back up once it has been
   * clean for a while.
   */
  noteDecoderDrops(channel: string, peerId: string, dropShare: number, decodeLoad: number | null) {
    const entry = this.entries.get(this.key(channel, peerId));
    if (!entry || entry.hidden) return;
    const now = Date.now();
    let changed = false;
    if (dropShare >= DROP_STEP_SHARE && decodeLoad !== null && decodeLoad >= DROP_DECODE_LOAD) {
      entry.cleanSince = null;
      entry.dropStrikes += 1;
      if (entry.dropStrikes >= DROP_STRIKES && entry.dropSteps < MAX_DROP_STEPS) {
        entry.dropSteps += 1;
        entry.dropStrikes = 0;
        if (entry.dropRecovered) entry.dropRecoverMs = Math.min(entry.dropRecoverMs * 2, DROP_RECOVER_MAX_MS);
        changed = true;
      }
    } else {
      entry.dropStrikes = 0;
      if (dropShare <= DROP_CLEAN_SHARE && entry.dropSteps > 0) {
        entry.cleanSince ??= now;
        if (now - entry.cleanSince >= entry.dropRecoverMs) {
          entry.dropSteps -= 1;
          entry.dropRecovered = true;
          entry.cleanSince = entry.dropSteps > 0 ? now : null;
          changed = true;
        }
      }
    }
    if (!changed) return;
    // The decoder is what is struggling, so this one does not wait.
    const sized = this.sizedTier(entry);
    if (sized) this.apply(entry, sized, false, true);
  }

  forget(channel: QualityChannel, peerId: string) {
    const key = this.key(channel, peerId);
    const entry = this.entries.get(key);
    if (entry?.timer) clearTimeout(entry.timer);
    this.entries.delete(key);
    if (this.entries.size === 0 && this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private ensureRefresh() {
    if (this.refreshTimer) return;
    this.refreshTimer = setInterval(() => {
      const now = Date.now();
      for (const entry of this.entries.values()) {
        if (entry.tier === null || now - entry.lastSentAt < REFRESH_MS) continue;
        this.send(entry);
      }
    }, REFRESH_MS);
  }
}

export const qualityNegotiator = new QualityNegotiator();

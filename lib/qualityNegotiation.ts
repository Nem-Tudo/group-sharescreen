// Viewer -> broadcaster quality requests.
//
// This is the highest-impact optimisation in the app. In a 30-person room
// the grid gives each tile roughly 320x216 CSS pixels, so shipping 1080p to
// it throws away about 95% of the encoded pixels — on the broadcaster's CPU
// as much as on their uplink. Letting each viewer state the size it actually
// renders at cuts both: measured against the previous "everyone gets the
// preset" behaviour, roughly 6x less upload and 7.8x less encode for the
// same visible result. Encode falls harder than bandwidth because encoder
// cost tracks pixels-per-second, and that is precisely the wall that made a
// large mesh room impossible.
//
// It rides the existing signalling relay: the server forwards a "signal"
// message's `data` payload opaquely (see server/signaling.ts's "signal"
// case, which only ever reads `data.kind` to label a metric), so a new kind
// travels end to end without a single backend change.

import type { ExtraCameraSlot } from "./multiCamera";
import type { ExtraScreenSlot } from "./multiScreen";
import { signalingClient } from "./signalingClient";
import { tierForRenderedSize, MAX_TIER_FPS, WORST_TIER, stepDownUnder, type QualityTier } from "./videoQuality";
import { isSqRecvDropsEnabled, SQ_EVENTS, SQ_RECV_DROPS_FEATURE, sqTrack } from "./streamQuality";

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
  width: number;
  height: number;
  tier: QualityTier | null;
  lastSentAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  /**
   * Whether this tile is currently off screen — scrolled out of the pane, or
   * on a page nobody is looking at.
   *
   * Kept apart from the measured size rather than folded into it, because
   * `report` deliberately ignores a 0x0 tile (see its comment) and so cannot
   * express this. The result was the opposite failure: a hidden tile stayed
   * pinned at whatever large tier it last asked for, and the periodic
   * re-announce kept demanding it every twenty seconds for as long as the
   * room stayed open.
   */
  hidden: boolean;
  /**
   * Experiment sq-recv-drops: tiers below the size-based one this tile asks
   * for while our decoder cannot keep up, and the bookkeeping that moves it.
   */
  dropSteps: number;
  /** The size-based tier last computed, before any decoder step. */
  sizedTier: QualityTier | null;
  dropStrikes: number;
  cleanSince: number | null;
}

// Experiment sq-recv-drops. Two telemetry samples in a row (~20 s) dropping a
// tenth of the frames step a tile down; a clean minute steps it back. Two
// steps at most: past that the decoder is not the only thing wrong, and the
// picture would be too small to be worth the trade.
const DROP_STEP_SHARE = 0.1;
const DROP_CLEAN_SHARE = 0.03;
const DROP_STRIKES = 2;
const DROP_RECOVER_MS = 60_000;
const MAX_DROP_STEPS = 2;

// Coalescing window for resize storms. A dragged window or an animated grid
// transition fires ResizeObserver continuously; without this each frame of
// that animation would be a signalling message and a remote setParameters.
const COALESCE_MS = 400;
// Re-announce periodically even when nothing changed, so a broadcaster that
// reconnected (new sendPC, fresh default tier) converges without needing a
// separate handshake.
const REFRESH_MS = 20_000;

class QualityNegotiator {
  private entries = new Map<string, Entry>();
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  private key(channel: QualityChannel, peerId: string) {
    return `${channel}:${peerId}`;
  }

  /**
   * Report the size a peer's video is currently rendered at, in CSS pixels.
   * Cheap to call on every ResizeObserver tick — sends are coalesced and
   * only actually go out when the resulting tier changes.
   */
  report(channel: QualityChannel, peerId: string, width: number, height: number) {
    // A tile that is not laid out yet (0x0, hidden tab, display:none) tells
    // us nothing. Reporting it would pin the peer to the worst tier and it
    // would stay pinned once the tile became visible again.
    if (width <= 0 || height <= 0) return;

    const key = this.key(channel, peerId);
    const entry =
      this.entries.get(key) ??
      {
        width: 0,
        height: 0,
        tier: null,
        lastSentAt: 0,
        timer: null,
        hidden: false,
        dropSteps: 0,
        sizedTier: null,
        dropStrikes: 0,
        cleanSince: null,
      };
    entry.width = width;
    entry.height = height;
    this.entries.set(key, entry);

    if (entry.timer) return;
    entry.timer = setTimeout(() => {
      entry.timer = null;
      this.flush(channel, peerId);
    }, COALESCE_MS);
    this.ensureRefresh();
  }

  /**
   * Say whether this peer's tile is on screen at all.
   *
   * A viewer that cannot see a tile has no use for its pixels, and saying so
   * is worth far more to the broadcaster than to us: they stop encoding a
   * large picture for somebody who is not looking at it, on the machine that
   * is already the bottleneck in a mesh room.
   */
  setHidden(channel: QualityChannel, peerId: string, hidden: boolean) {
    const key = this.key(channel, peerId);
    const entry = this.entries.get(key);
    // Nothing to say about a tile that has never reported a size: there is no
    // standing request to walk back.
    if (!entry || entry.hidden === hidden) return;
    entry.hidden = hidden;
    // Through the same coalescing window as a resize, so scrolling a long
    // filmstrip past a dozen tiles is not a dozen signalling messages.
    if (entry.timer) return;
    entry.timer = setTimeout(() => {
      entry.timer = null;
      this.flush(channel, peerId);
    }, COALESCE_MS);
    this.ensureRefresh();
  }

  private flush(channel: QualityChannel, peerId: string, force = false) {
    const key = this.key(channel, peerId);
    const entry = this.entries.get(key);
    if (!entry) return;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio : 1;
    // MAX_TIER_FPS rather than the default 60: tile size decides pixels, never
    // frames, so the request asks for the fastest rung at that size and the
    // broadcaster's fps dial caps it (see capTier). Leaving the default here
    // capped every viewer at 60 and made the 120 fps dial capture-only.
    // Under sq-recv-drops the hysteresis is seeded with the size-based tier
    // from before any decoder step, so a step down is never read as "the tile
    // is already on a small tier" when deciding the next size-based answer.
    const seed = isSqRecvDropsEnabled() ? entry.sizedTier : entry.tier;
    const sized = tierForRenderedSize(entry.width, entry.height, dpr, seed ?? undefined, MAX_TIER_FPS);
    entry.sizedTier = sized;
    const next = entry.hidden ? WORST_TIER : entry.dropSteps > 0 ? stepDownUnder(sized, entry.dropSteps) : sized;
    if (!force && next === entry.tier) return;
    entry.tier = next;
    entry.lastSentAt = Date.now();
    signalingClient.sendSignal(peerId, {
      channel,
      role: "viewer",
      kind: "quality",
      tier: next,
    });
  }

  /**
   * Force this peer to be told our current tier again — used when a fresh
   * stream arrives from them, since that means a brand new sender on their
   * side that has never heard our request.
   */
  announce(channel: QualityChannel, peerId: string) {
    const entry = this.entries.get(this.key(channel, peerId));
    if (!entry || entry.width <= 0) return;
    // Hidden tiles still announce — flush reads `hidden` and sends the worst
    // tier, which is exactly what a fresh sender needs to hear from a viewer
    // who is not looking.
    this.flush(channel, peerId, true);
  }

  /**
   * Whether this peer's tile is on screen in a page somebody is looking at;
   * null when the tile has never reported (a relay's re-encode, a channel
   * without one). For the connection-quality reports — see
   * connectionTelemetrySummary's MIN_VISIBLE_SHARE.
   */
  isVisible(channel: string, peerId: string): boolean | null {
    const entry = this.entries.get(`${channel}:${peerId}`);
    if (!entry) return null;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return false;
    return !entry.hidden;
  }

  /**
   * One telemetry sample of this tile's decoder: the share of received frames
   * it dropped. Experiment sq-recv-drops steps the tile's request down while
   * that stays high, and back up once it has been clean for a while.
   */
  noteDecoderDrops(channel: string, peerId: string, dropShare: number) {
    if (!isSqRecvDropsEnabled()) return;
    const entry = this.entries.get(`${channel}:${peerId}`);
    if (!entry || entry.hidden) return;
    const now = Date.now();
    let changed = false;
    if (dropShare >= DROP_STEP_SHARE) {
      entry.cleanSince = null;
      entry.dropStrikes += 1;
      if (entry.dropStrikes >= DROP_STRIKES && entry.dropSteps < MAX_DROP_STEPS) {
        entry.dropSteps += 1;
        entry.dropStrikes = 0;
        changed = true;
        sqTrack(SQ_EVENTS.dropStep, SQ_RECV_DROPS_FEATURE, entry.dropSteps);
      }
    } else {
      entry.dropStrikes = 0;
      if (dropShare <= DROP_CLEAN_SHARE && entry.dropSteps > 0) {
        entry.cleanSince ??= now;
        if (now - entry.cleanSince >= DROP_RECOVER_MS) {
          entry.dropSteps -= 1;
          entry.cleanSince = entry.dropSteps > 0 ? now : null;
          changed = true;
        }
      }
    }
    if (changed) this.flush(channel as QualityChannel, peerId, true);
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
      for (const [key, entry] of this.entries) {
        if (entry.tier === null || now - entry.lastSentAt < REFRESH_MS) continue;
        const [channel, peerId] = key.split(":") as [QualityChannel, string];
        this.flush(channel, peerId, true);
      }
    }, REFRESH_MS);
  }
}

export const qualityNegotiator = new QualityNegotiator();

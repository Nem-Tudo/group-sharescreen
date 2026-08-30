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

import { signalingClient } from "./signalingClient";
import { tierForRenderedSize, type QualityTier } from "./videoQuality";

// The video channels a viewer can ask for a size on. The "fileN" ones are
// local files being played into the room (see lib/localMediaSource.ts) — a
// channel each, precisely so several can run at once and alongside a screen
// share, and each wants the same per-viewer downscaling as the other two.
export type QualityChannel = "screen" | "camera" | "file1" | "file2" | "file3";

interface Entry {
  width: number;
  height: number;
  tier: QualityTier | null;
  lastSentAt: number;
  timer: ReturnType<typeof setTimeout> | null;
}

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
      this.entries.get(key) ?? { width: 0, height: 0, tier: null, lastSentAt: 0, timer: null };
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

  private flush(channel: QualityChannel, peerId: string, force = false) {
    const key = this.key(channel, peerId);
    const entry = this.entries.get(key);
    if (!entry) return;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio : 1;
    const next = tierForRenderedSize(entry.width, entry.height, dpr, entry.tier ?? undefined);
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
    this.flush(channel, peerId, true);
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

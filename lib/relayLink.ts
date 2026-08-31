// Relay execution: forwarding a stream we are *receiving* onward to other
// viewers, so the original broadcaster does not have to reach everybody.
//
// Read this before touching RELAY_ENABLED below:
//
// A browser cannot forward RTP. There is no passthrough — WebRTC Encoded
// Transforms exist but the spec explicitly does not cover cross-PeerConnection
// forwarding, and the parts that would make it work (codec matching, SSRC and
// timestamp rewriting, PLI propagation) are undefined. So `pc.ontrack` gives
// us a decoded MediaStreamTrack and `addTrack` re-encodes it. Every hop costs:
//
//   - ~120-220 ms of added latency (jitter buffer + decode + encode + network)
//   - one full generation of re-encoding loss
//   - the relay's CPU and uplink, spent on strangers
//
// One thing the transcode buys back: because the relay re-encodes, it produces
// its own keyframes. The classic relay problem of "a new viewer joins and
// waits for an IDR from the top of the tree" simply does not exist here.
//
// The cost is why the planner treats this as an escape hatch and why depth is
// capped at 3. It is not the normal shape of a room and must never become it.

import { signalingClient } from "./signalingClient";
import { iceConfigFor } from "./iceConfig";
import { PeerQualityRegistry, type DegradationMode } from "./peerQualityController";
import { applyVideoCodecPreferences } from "./videoCodecPreferences";
import { tierSpec, type QualityTier } from "./videoQuality";

// On by default — but the planner (see useMeshTopology's
// CASCADE_ROOM_SIZE_THRESHOLD) never actually builds a relay assignment for a
// room of 10 people or fewer, so in practice this only ever engages in a
// room big enough that the alternative (degrading everyone a tier or two
// instead) is the worse trade. Set NEXT_PUBLIC_RELAY_ENABLED=false to kill
// the whole mechanism outright regardless of room size, e.g. if churn
// handling — what an orphaned child sees for the few seconds between its
// relay dying and the broadcaster re-parenting it directly, see
// RelayLink.checkStall and applyRelayPlan's re-adoption path — turns out to
// need more field time before it's trusted at scale.
export const RELAY_ENABLED = process.env.NEXT_PUBLIC_RELAY_ENABLED !== "false";

export interface RelayChild {
  id: string;
  tier: QualityTier;
}

// A viewer whose stream arrives via a relay must still see it attributed to
// the person actually sharing, not to whoever forwarded it. Every relayed
// offer therefore carries the origin id, and the receiving side files the
// stream under that instead of under the sender.
export interface RelayOfferMeta {
  originId: string;
}

// How long the incoming stream may deliver nothing before this relay decides
// its source is genuinely gone rather than merely quiet.
//
// This is deliberately long, and the previous 1.5s was the single most
// destructive number in the cascade. A screen share of static content produces
// *no media at all* while nothing on screen changes — that is the whole point
// of a screen codec, and it is the normal state of the most common thing
// anyone shares: a slide, a document, an editor sitting still. At 1.5s every
// such pause was read as a dead source, so the relay tore down its entire
// subtree, reported itself unusable and destroyed itself, several times a
// minute, in a loop. A presentation in a large room could not stay up.
//
// The connection genuinely dying is not what this catches and never was: a
// recvPC that fails or closes already releases the relay through
// closeRecvPC/RelayManager.release. What is left for this to catch is the much
// rarer "connected, but the media stopped" case, and being slow about that
// costs a frozen tile for a few seconds, where being fast about it cost the
// room its cascade.
const SOURCE_STALL_MS = 12_000;
const STALL_CHECK_MS = 1000;

// Distinguishes one relay's senders from another's — and from the broadcast
// channels' — inside the process-wide stats pump (see PeerQualityRegistry's
// constructor). A counter rather than the origin id because a class field
// initializer cannot see a parameter property, and a relay for the same origin
// can legitimately be rebuilt while the old one is still winding down.
let relaySeq = 0;

type RelayChildState = {
  pc: RTCPeerConnection;
  tier: QualityTier;
  // Renegotiates this child's candidate pair without rebuilding the
  // connection. See openChild — it closes over the pc, and returns false when
  // a restart is unavailable or has already been spent on this failure.
  restartIce: () => boolean;
};

export class RelayLink {
  private children = new Map<string, RelayChildState>();
  private quality = new PeerQualityRegistry(`relay:${(relaySeq += 1)}`);
  private stallTimer: ReturnType<typeof setInterval> | null = null;
  private lastBytes = 0;
  private lastMediaAt = 0;
  // The origin's own "O que você está compartilhando" pick — carried over
  // from theirs rather than defaulting here (see setChildren), because a
  // relay's re-encode is the same content, being handed to the same kind of
  // viewer, and deserves the same treatment. Left unset before the first
  // relay-assign arrives, but that assignment is also what triggers the
  // first openChild, so no child is ever built against the wrong value.
  private degradation: DegradationMode = "text";

  constructor(
    /** Who originally produced this stream — not who handed it to us. */
    readonly originId: string,
    private stream: MediaStream,
    /** The recvPC the stream arrives on, watched for stalls. */
    private sourcePc: RTCPeerConnection,
    /** This relay operator's own "Impedir conexões diretas" preference — applied to every child connection it opens below. */
    private forceRelayIce: boolean,
    private onSourceLost: () => void
  ) {}

  /**
   * Reconciles our children against a fresh assignment from the root, and
   * updates what content this actually is — see the `degradation` field.
   * Applied to every already-open child's live sender immediately (a
   * setParameters call, same as any other tier/ceiling change — see
   * PeerQualityController.setDegradation); a *new* codec preference only
   * ever takes effect on a fresh transceiver, so it only reaches children
   * opened after this call, exactly like the root's own openSendPC.
   */
  setChildren(assignment: RelayChild[], degradation: DegradationMode) {
    this.degradation = degradation;
    this.quality.setDegradation(degradation);
    const wanted = new Map(assignment.map((c) => [c.id, c.tier]));
    for (const id of [...this.children.keys()]) {
      // Dropped from the assignment means the root moved them, not that their
      // stream ended — the root opens their replacement in the same pass.
      if (!wanted.has(id)) this.closeChild(id, "reparent");
    }
    for (const [id, tier] of wanted) {
      const existing = this.children.get(id);
      if (existing) {
        if (existing.tier !== tier) {
          existing.tier = tier;
          this.quality.get(id)?.setTier(tier);
        }
        continue;
      }
      this.openChild(id, tier);
    }
    this.ensureStallWatch();
  }

  private openChild(peerId: string, tier: QualityTier) {
    const pc = new RTCPeerConnection(iceConfigFor(this.forceRelayIce));

    // Mirrors the root broadcaster's own recovery (see useRoomMedia's
    // restartSendIce). It matters more here, not less: a relay's children are
    // the deepest viewers in the room, a rebuild costs them a full decode gap
    // plus a fresh re-encode out of a machine that is already spending itself
    // on everyone else's behalf, and this connection's quality controller has
    // learned their link the same way the root's has.
    let iceRestartTried = false;
    const restartIce = () => {
      if (iceRestartTried) return false;
      if (pc.connectionState === "closed" || pc.signalingState !== "stable") return false;
      iceRestartTried = true;
      try {
        pc.restartIce?.();
      } catch {
        return false;
      }
      pc.createOffer({ iceRestart: true })
        .then(async (offer) => {
          if (this.children.get(peerId)?.pc !== pc) return;
          await pc.setLocalDescription(offer);
          if (this.children.get(peerId)?.pc !== pc) return;
          signalingClient.sendSignal(peerId, {
            channel: "screen",
            role: "broadcaster",
            kind: "offer",
            sdp: pc.localDescription,
            originId: this.originId,
            // Tells the child to answer on the pc it already has rather than
            // replacing it — see useRoomMedia's offer handler.
            iceRestart: true,
          });
        })
        .catch(() => this.closeChild(peerId));
      return true;
    };

    this.children.set(peerId, { pc, tier, restartIce });

    for (const track of this.stream.getTracks()) {
      const sender = pc.addTrack(track, this.stream);
      if (track.kind === "video") {
        // Both of these used to be skipped entirely on the relay path — a
        // relayed viewer's picture was encoded with the browser's untuned
        // defaults regardless of what the broadcaster actually picked,
        // which is a plausible source of "losing FPS" complaints on its
        // own: exactly the deepest, most cascade-dependent viewers got the
        // least-informed encode of anyone in the room.
        track.contentHint = this.degradation === "text" ? "text" : "motion";
        const transceivers = pc.getTransceivers();
        const transceiver = transceivers.find((t) => t.sender === sender);
        if (transceiver) applyVideoCodecPreferences(transceiver, this.degradation);
        // A *remote* track's getSettings() is usually empty until frames have
        // actually arrived, so this legitimately starts out unknown. The
        // fallback deliberately keeps the sender at scale 1 rather than
        // guessing; the stall watcher below corrects it as soon as the real
        // dimensions exist, which is what makes a relayed viewer receive the
        // tier they were assigned instead of always the full-size re-encode.
        const height = track.getSettings().height ?? tierSpec(tier).height;
        this.quality.add(peerId, pc, sender, tier, height);
      }
    }

    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      signalingClient.sendSignal(peerId, {
        channel: "screen",
        role: "broadcaster",
        kind: "ice",
        candidate: e.candidate.toJSON(),
        originId: this.originId,
      });
    };
    pc.onconnectionstatechange = () => {
      if (this.children.get(peerId)?.pc !== pc) return;
      if (pc.connectionState === "failed") {
        // Try the cheap repair before giving up on them. Dropping the child
        // outright also sends them a "stop", which clears their tile and takes
        // away the reconnect-request they would otherwise have used to ask for
        // a repair themselves — so this really is the only chance.
        if (restartIce()) return;
        this.closeChild(peerId);
      } else if (pc.connectionState === "closed") {
        this.closeChild(peerId);
      } else if (pc.connectionState === "connected") {
        iceRestartTried = false;
      }
    };

    pc.createOffer()
      .then(async (offer) => {
        if (this.children.get(peerId)?.pc !== pc) return;
        await pc.setLocalDescription(offer);
        if (this.children.get(peerId)?.pc !== pc) return;
        signalingClient.sendSignal(peerId, {
          channel: "screen",
          role: "broadcaster",
          kind: "offer",
          sdp: pc.localDescription,
          // Without this the child would file the stream under our id and
          // show us as the person sharing.
          originId: this.originId,
        });
      })
      .catch(() => this.closeChild(peerId));
  }

  acceptAnswer(peerId: string, sdp: RTCSessionDescriptionInit) {
    this.children.get(peerId)?.pc.setRemoteDescription(sdp).catch(() => {});
  }

  acceptCandidate(peerId: string, candidate: RTCIceCandidateInit) {
    this.children.get(peerId)?.pc.addIceCandidate(candidate).catch(() => {});
  }

  hasChild(peerId: string): boolean {
    return this.children.has(peerId);
  }

  hasChildren(): boolean {
    return this.children.size > 0;
  }

  /**
   * Rebuilds one child's connection from scratch, keeping its assigned tier.
   *
   * Called when that child tells us its side of the link is dead (see
   * useRoomMedia's "reconnect-request"). A relay is the only party able to act
   * on that: the original broadcaster does not have a connection to this
   * viewer, and our own pc can sit at "connected" indefinitely while theirs is
   * gone, because ICE state is computed independently on each side.
   */
  reopenChild(peerId: string) {
    const existing = this.children.get(peerId);
    if (!existing) return;
    // They told us their side is dead while ours may still read as connected,
    // which is the asymmetry an ICE restart exists for. Only if that is
    // unavailable do we pay for a whole new connection.
    if (existing.restartIce()) return;
    const { tier } = existing;
    // Straight to close, without closeChild's "stop" signal: telling the child
    // to give up is the opposite of what it just asked us for.
    existing.pc.close();
    this.children.delete(peerId);
    this.quality.remove(peerId);
    this.openChild(peerId, tier);
  }

  /**
   * Drops one child.
   *
   * `reason` decides what the child is told, and the distinction matters to
   * them a great deal more than it does to us:
   *
   *  - "reparent": the plan moved them elsewhere and another offer is already
   *    coming. They hold a placeholder instead of clearing the tile.
   *  - "ended": we can no longer serve this stream at all. They clear it.
   *  - "requested": they asked us to stop, so telling them to stop would be
   *    an echo — and one that would clear the very placeholder their own
   *    request just put up. Nothing is sent.
   */
  private closeChild(peerId: string, reason: "ended" | "reparent" | "requested" = "ended") {
    const entry = this.children.get(peerId);
    if (!entry) return;
    entry.pc.close();
    this.children.delete(peerId);
    this.quality.remove(peerId);
    if (reason === "requested") return;
    signalingClient.sendSignal(peerId, {
      channel: "screen",
      role: "broadcaster",
      kind: "stop",
      originId: this.originId,
      reparenting: reason === "reparent",
    });
  }

  /** The child asked us to stop sending. Frees the re-encode immediately. */
  releaseChild(peerId: string) {
    this.closeChild(peerId, "requested");
  }

  // Watches the *incoming* stream. A relay whose own source died is worse
  // than useless: its children see a frozen frame with no indication anything
  // is wrong, and nothing else in the system would notice, because from the
  // root's point of view the relay is still connected and still assigned.
  private ensureStallWatch() {
    if (this.stallTimer || this.children.size === 0) return;
    this.lastMediaAt = Date.now();
    this.stallTimer = setInterval(() => {
      void this.checkStall();
    }, STALL_CHECK_MS);
  }

  private async checkStall() {
    if (this.children.size === 0) return;
    // The incoming track's real dimensions are only knowable once frames have
    // been decoded, which is after openChild has already had to pick a
    // captureHeight — so this is where the guess gets replaced with the truth,
    // and where a source that changes size mid-share (the origin switching
    // window or monitor) is picked up.
    const sourceHeight = this.stream.getVideoTracks()[0]?.getSettings().height;
    if (sourceHeight) this.quality.setCaptureHeight(sourceHeight);
    // A source whose transport has already given up is not a stall, it is a
    // loss, and closeRecvPC handles that far more directly than this poll ever
    // could. Bailing out here keeps the two paths from racing to tear the same
    // link down twice.
    const sourceState = this.sourcePc.connectionState;
    if (sourceState === "closed" || sourceState === "failed") return;

    let bytes = 0;
    try {
      const report = await this.sourcePc.getStats();
      report.forEach((r) => {
        const rec = r as unknown as Record<string, unknown>;
        if (r.type === "inbound-rtp" && rec.kind === "video") {
          // Bytes rather than framesDecoded. They mostly move together, but
          // bytes also count the packets a codec emits without producing a new
          // decodable frame, so this errs towards "still alive" — which is the
          // right direction to err when the cost of a false positive is
          // demolishing a working subtree.
          bytes = (rec.bytesReceived as number) ?? 0;
        }
      });
    } catch {
      return;
    }
    const now = Date.now();
    if (bytes > this.lastBytes) {
      this.lastBytes = bytes;
      this.lastMediaAt = now;
      return;
    }
    if (now - this.lastMediaAt > SOURCE_STALL_MS) {
      // Tell the children right away so they can re-parent, rather than
      // leaving them to discover it via their own stall detection.
      for (const peerId of [...this.children.keys()]) this.closeChild(peerId);
      this.onSourceLost();
      this.dispose();
    }
  }

  dispose() {
    if (this.stallTimer) {
      clearInterval(this.stallTimer);
      this.stallTimer = null;
    }
    for (const peerId of [...this.children.keys()]) this.closeChild(peerId);
    this.quality.clear();
  }
}

/**
 * Owns every RelayLink this client is currently running (one per origin it is
 * forwarding). Most clients never create one.
 */
export class RelayManager {
  private links = new Map<string, RelayLink>();

  get(originId: string): RelayLink | undefined {
    return this.links.get(originId);
  }

  /** Finds the link that is serving `peerId`, for routing answers and ICE. */
  findByChild(peerId: string): RelayLink | undefined {
    for (const link of this.links.values()) {
      if (link.hasChild(peerId)) return link;
    }
    return undefined;
  }

  ensure(
    originId: string,
    stream: MediaStream,
    sourcePc: RTCPeerConnection,
    forceRelayIce: boolean,
    onSourceLost: () => void
  ): RelayLink {
    const existing = this.links.get(originId);
    if (existing) return existing;
    const link = new RelayLink(originId, stream, sourcePc, forceRelayIce, () => {
      this.links.delete(originId);
      onSourceLost();
    });
    this.links.set(originId, link);
    return link;
  }

  release(originId: string) {
    this.links.get(originId)?.dispose();
    this.links.delete(originId);
  }

  clear() {
    for (const link of this.links.values()) link.dispose();
    this.links.clear();
  }

  get size(): number {
    return this.links.size;
  }
}

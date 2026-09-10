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
import {
  PeerQualityRegistry,
  contentHintForDegradation,
  type DegradationMode,
} from "./peerQualityController";
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

// How long a child may take to come up before this relay gives it back to the
// root. The relay's copy of useRoomMedia's CONNECT_TIMEOUT_MS, and kept at the
// same value for the same reason: it has to cover ICE/TURN negotiation on a
// slow link without being so long that a viewer stares at a placeholder.
//
// Its absence was a hole with no bottom. A relay's offer is an ordinary
// signalling message and can be dropped silently (a socket mid-reconnect, the
// server's wsSignalLimiter, a full pending-signal queue), and a pc that never
// receives an answer never starts ICE at all — so it sits at "new" forever and
// `connectionState` never reaches "failed". Nothing else would have noticed:
// setChildren finds the child still in `this.children` and leaves it alone, the
// root has already handed them over and stopped serving them directly, and the
// viewer has closed its own recvPC and is showing "Retomando...". All three
// parties were waiting on one of the other two, permanently.
const CHILD_CONNECT_TIMEOUT_MS = 15_000;

// Same backstop, re-armed after an ICE restart. Shorter for the same reason
// the root's ICE_RESTART_TIMEOUT_MS is: a restart is one already-established
// peer re-gathering candidates, not a whole room's opening burst.
const CHILD_ICE_RESTART_TIMEOUT_MS = 6000;

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
  // Backstop for "this connection never came up at all" — see
  // CHILD_CONNECT_TIMEOUT_MS. Null once it has fired or been disarmed.
  connectTimer: ReturnType<typeof setTimeout> | null;
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
  // The app-wide default, until the origin's own pick arrives via
  // setChildren — see useRoomMedia's shareProfile.
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
   * Applied to every already-open child's live sender immediately: its
   * degradationPreference (a setParameters call, same as any other
   * tier/ceiling change — see PeerQualityController.setDegradation) and the
   * contentHint on the track being re-encoded, which is shared by all of
   * them. A *new* codec preference only ever takes effect on a fresh
   * transceiver, so that one alone still reaches only children opened after
   * this call, exactly like the root's own openSendPC.
   */
  setChildren(assignment: RelayChild[], degradation: DegradationMode) {
    this.degradation = degradation;
    this.quality.setDegradation(degradation);
    // The hint is a property of the track we are re-encoding, so it applies
    // to every child at once and, unlike the codec preference, needs no
    // renegotiation to change. It was only ever set in openChild, so a
    // profile switch mid-share reached a relay's degradationPreference and
    // stopped there: its children kept being encoded under the hint of
    // whatever profile was current when they connected. Half a profile is
    // arguably worse than none — "motion" degradation with a "text" hint is a
    // combination nobody picked.
    for (const track of this.stream.getVideoTracks()) {
      track.contentHint = contentHintForDegradation(degradation);
    }
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

    // See CHILD_CONNECT_TIMEOUT_MS. Called after this.children.set below, so
    // there is always an entry to hang the timer on.
    const armConnectTimeout = (ms: number) => {
      const entry = this.children.get(peerId);
      if (!entry || entry.pc !== pc) return;
      if (entry.connectTimer) clearTimeout(entry.connectTimer);
      entry.connectTimer = setTimeout(() => {
        const current = this.children.get(peerId);
        if (!current || current.pc !== pc) return;
        current.connectTimer = null;
        if (pc.connectionState === "connected") return;
        // Hand them back rather than retrying here. We have already spent this
        // handover's budget and evidently cannot reach them; the root can, and
        // is the only party able to act while we are the reason they are dark.
        this.giveBackToRoot(peerId);
      }, ms);
    };

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
          // A restart can go nowhere just as easily as a first offer can, and
          // leaves the pc in exactly the same never-fails limbo.
          armConnectTimeout(CHILD_ICE_RESTART_TIMEOUT_MS);
        })
        .catch(() => {
          // Only if this is still *our* pc. Without the check a rejection from
          // a superseded negotiation tore down the healthy child that had
          // already replaced it.
          if (this.children.get(peerId)?.pc !== pc) return;
          this.giveBackToRoot(peerId);
        });
      return true;
    };

    this.children.set(peerId, { pc, tier, restartIce, connectTimer: null });
    armConnectTimeout(CHILD_CONNECT_TIMEOUT_MS);

    for (const track of this.stream.getTracks()) {
      const sender = pc.addTrack(track, this.stream);
      if (track.kind === "video") {
        // Both of these used to be skipped entirely on the relay path — a
        // relayed viewer's picture was encoded with the browser's untuned
        // defaults regardless of what the broadcaster actually picked,
        // which is a plausible source of "losing FPS" complaints on its
        // own: exactly the deepest, most cascade-dependent viewers got the
        // least-informed encode of anyone in the room.
        // Both quality profiles bias toward sharpness here, matching the
        // origin encode (see useRoomMedia's hint logic): "text" holds
        // resolution absolutely, "balanced" gets "detail" so the re-encode a
        // relayed viewer receives keeps the picture the profile promises
        // rather than the soft, frame-first one "motion" produced. What still
        // separates balanced from text is degradationPreference, not the hint.
        // Only genuine motion content ("motion") keeps the motion hint.
        track.contentHint = contentHintForDegradation(this.degradation);
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
        // Try the cheap repair before giving up on them.
        if (restartIce()) return;
        this.giveBackToRoot(peerId);
      } else if (pc.connectionState === "closed") {
        this.closeChild(peerId);
      } else if (pc.connectionState === "connected") {
        iceRestartTried = false;
        const entry = this.children.get(peerId);
        if (entry?.connectTimer) {
          clearTimeout(entry.connectTimer);
          entry.connectTimer = null;
        }
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
      .catch(() => {
        if (this.children.get(peerId)?.pc !== pc) return;
        this.giveBackToRoot(peerId);
      });
  }

  /**
   * Gives one child back to the root: we cannot serve them, and saying so is
   * the only thing that will get them a picture again.
   *
   * Every path that abandons a child goes through here. Simply dropping them,
   * which is what the failure paths used to do, left nobody serving them at
   * all — the root goes on believing this relay has them (see relayedAway in
   * useRoomMedia) and has no reason to ever look again — and the "stop" they
   * were sent told them the stream had ended rather than that another was on
   * its way, so their tile cleared instead of holding a placeholder.
   *
   * A no-op when the child is already gone: whoever removed it has dealt with
   * this, and a second nack for a viewer somebody else may already be serving
   * would only pull them back off a working connection.
   */
  private giveBackToRoot(peerId: string) {
    const entry = this.children.get(peerId);
    if (!entry) return;
    const { tier } = entry;
    this.closeChild(peerId, "reparent");
    this.nack([{ id: peerId, tier }]);
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
    if (existing.connectTimer) clearTimeout(existing.connectTimer);
    existing.pc.close();
    this.children.delete(peerId);
    this.quality.remove(peerId);
    this.openChild(peerId, tier);
  }

  /**
   * Tells the root we cannot serve these viewers, so it takes them back.
   *
   * The same message the "no source" path already sends (see useRoomMedia's
   * relay-assign handler) and handled identically there: the root drops them
   * from relayedAway and reopens a direct connection. It also stops routing
   * them through a relay for a while — see RELAY_OPT_OUT_MS — so a child we
   * demonstrably cannot reach is not handed straight back to us by the next
   * planning pass, which would otherwise flap them every six seconds.
   */
  private nack(children: RelayChild[]) {
    if (children.length === 0) return;
    signalingClient.sendSignal(this.originId, {
      channel: "screen",
      role: "viewer",
      kind: "relay-nack",
      originId: this.originId,
      children,
    });
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
    if (entry.connectTimer) clearTimeout(entry.connectTimer);
    entry.pc.close();
    this.children.delete(peerId);
    this.quality.remove(peerId);
    // A relay with no children forwards nothing, so there is nothing left to
    // watch for stalls. Worth stopping now that "no children" is an ordinary
    // state a link sits in rather than a moment on its way to being disposed:
    // an idle relay would otherwise keep running a getStats() pass every
    // second for the life of the room. ensureStallWatch restarts it the
    // moment setChildren gives it somebody again.
    if (this.children.size === 0 && this.stallTimer) {
      clearInterval(this.stallTimer);
      this.stallTimer = null;
    }
    if (reason === "requested") return;
    signalingClient.sendSignal(peerId, {
      channel: "screen",
      role: "broadcaster",
      kind: "stop",
      originId: this.originId,
      reparenting: reason === "reparent",
    });
  }

  /**
   * Releases every child without tearing this link down — the root saying this
   * relay is no longer part of the plan (an assignment naming nobody, see
   * useRoomMedia's applyRelayPlan).
   *
   * Told as a reparent because that is what it is: the root opens a direct
   * connection to each of these same people in the very same pass.
   */
  releaseAllChildren() {
    for (const peerId of [...this.children.keys()]) this.closeChild(peerId, "reparent");
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
    // The last child may have been released while getStats was in flight, and
    // the check at the top of this method has already been passed. Declaring a
    // source lost on behalf of nobody would report this relay unusable and
    // dispose it for no reason.
    if (this.children.size === 0) return;
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

  /**
   * Shuts this relay down and tells every child why.
   *
   * `reason` is passed straight through to closeChild, and the caller is the
   * only party that knows which one is true. "ended" — the default and the
   * right answer for a source that genuinely died or a room being left — is
   * wrong for the one case that used to share it: our own source being
   * *reparented*. There the stream has not ended at all, we are simply about
   * to receive it from somebody else, and telling a whole subtree it ended
   * made every reparenting of a mid-tree relay blank every tile beneath it.
   */
  dispose(reason: "ended" | "reparent" = "ended") {
    if (this.stallTimer) {
      clearInterval(this.stallTimer);
      this.stallTimer = null;
    }
    for (const peerId of [...this.children.keys()]) this.closeChild(peerId, reason);
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

  /** See RelayLink.dispose for what `reason` decides. */
  release(originId: string, reason: "ended" | "reparent" = "ended") {
    this.links.get(originId)?.dispose(reason);
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

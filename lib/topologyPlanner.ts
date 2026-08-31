// Topology planner: decides who sends to whom.
//
// The governing idea is that cascading is an *escape hatch*, not an
// architecture. Relaying costs a full decode+re-encode on a participant's
// machine (browsers have no RTP passthrough — WebRTC Encoded Transforms are
// explicitly not specified for cross-PeerConnection forwarding), so every
// extra hop costs latency, a generation of re-encoding, and someone's CPU.
// The plan therefore stays at depth 1 — plain direct mesh, nobody relaying —
// for as long as the root's *measured* budget covers the room, and only
// deepens when it genuinely cannot.
//
// With per-viewer tiering in place (see videoQuality.tierForRenderedSize),
// depth 1 covers a great deal more than it looks: a 30-person room where
// most viewers are small grid tiles costs roughly 24 Mbps and 460 Mpx/s,
// which an ordinary desktop serves directly. Cascading then only engages for
// a weak uplink, a weak CPU, or the everyone-goes-fullscreen case.

import {
  encodeMpxs,
  stepDown,
  tierIndex,
  uploadKbps,
  TIERS,
  WORST_TIER,
  type QualityTier,
} from "./videoQuality";

export interface PlannerNode {
  id: string;
  /** Uplink, kbps. See `measured` before trusting it. */
  uploadKbps: number;
  /** Encode budget, megapixels/second. See `measured` before trusting it. */
  encodeMpxs: number;
  /** Seconds this node has been connected — a proxy for "won't vanish". */
  stableSeconds: number;
  /** Mobile/battery devices are never promoted to relay. */
  eligibleRelay: boolean;
  /**
   * Whether the two figures above came from observing real traffic, or are
   * this device's opening assumption about itself.
   *
   * The distinction is load-bearing and used to be invisible. A viewer that is
   * neither sharing nor relaying has no outbound media, so nothing ever runs
   * the stats pump for it and its numbers stay at the seeded defaults — an
   * assumed uplink, and an encode budget extrapolated from core count. Every
   * such viewer therefore advertised the *same* comfortable figures no matter
   * what their connection or machine actually was, and the planner, unable to
   * tell that apart from a measurement, promoted them on the strength of it.
   * Someone on a slow uplink would be handed a subtree and collapse under it.
   *
   * Unmeasured nodes are still usable — refusing them outright would disable
   * cascading entirely, since a viewer cannot measure an uplink it is not
   * using — but they are discounted (see UNMEASURED_DISCOUNT) and sorted
   * behind anyone who has actually proven what they can carry.
   */
  measured: boolean;
}

export interface PlannerViewer extends PlannerNode {
  /** Tier this viewer actually needs, from its rendered tile size. */
  wantTier: QualityTier;
}

export interface PlanEdge {
  from: string;
  to: string;
  tier: QualityTier;
  depth: number;
}

export interface TopologyPlan {
  edges: PlanEdge[];
  /** 1 means plain mesh: nobody is relaying. */
  depth: number;
  /** Node ids that must relay to someone. Empty at depth 1. */
  relays: string[];
  /** How many tiers the whole room was knocked down to make it fit. */
  globalDowngrade: number;
  /** Viewers that could not be served at all, even at the worst tier. */
  unserved: string[];
  rootUploadKbps: number;
  rootEncodeMpxs: number;
}

// Never plan against 100% of a measured link or CPU: bandwidth estimates
// overshoot, and an encoder pinned at exactly its ceiling drops frames.
//
// Kept deliberately narrow, though. Every percent held back here is quality
// taken from the whole room — the reserve is not spare capacity, it is the
// difference between everyone watching at 1080p and everyone watching at
// 720p — and it is the *second* line of defence, not the first: WebRTC's own
// bandwidth estimator reacts to real congestion within a second or two, long
// before a plan that only re-evaluates every six could. A quarter of the link
// permanently unspent was paying twice for the same insurance.
const UPLOAD_HEADROOM = 0.85;
const ENCODE_HEADROOM = 0.85;

// Hard cap on tree depth. Each hop adds ~120-220 ms and one re-encode
// generation; past three the picture is visibly degraded and the latency is
// no longer "live". Beyond this the planner degrades quality instead of
// deepening, which is the better trade.
const MAX_DEPTH = 3;

// Hard ceiling on how many children any one relay may be given, whatever the
// arithmetic says it can afford.
//
// The arithmetic was the problem. With an unmeasured node's assumed budget and
// a cheap content multiplier, slotsFor would happily conclude a single viewer
// could carry twenty-odd children: ~27 by upload and ~38 by encode is a real
// pair of numbers this produced for 576p30 static content. Nobody's browser
// survives twenty simultaneous re-encodes, and when it stops surviving, every
// one of those children goes black at once. A relay is a favour asked of a
// participant who came to watch, and the size of the favour has to be bounded
// by something other than optimism.
const MAX_CHILDREN_PER_RELAY = 4;

// What an unmeasured node's self-reported budget is worth (see
// PlannerNode.measured). Not zero, because it is a genuine best guess and
// cascading has to be possible at all; not one, because it is a guess about
// the one thing that decides whether promoting this person wrecks their
// experience and their children's.
const UNMEASURED_DISCOUNT = 0.4;

interface WorkNode extends PlannerNode {
  usedUploadKbps: number;
  usedEncodeMpxs: number;
  usedChildren: number;
  depth: number;
  served: boolean;
  isRoot: boolean;
}

// The share of a node's claimed budget the planner is willing to spend. The
// root's own figures come from its live encoders and are trusted as given; a
// viewer's may be nothing more than a default it has never had occasion to
// test (see PlannerNode.measured).
function trust(n: WorkNode): number {
  return n.isRoot || n.measured ? 1 : UNMEASURED_DISCOUNT;
}

function freeUpload(n: WorkNode): number {
  return n.uploadKbps * trust(n) * UPLOAD_HEADROOM - n.usedUploadKbps;
}

// The cap does not apply to the root: it is the one node that chose to be
// here, whose budget is genuinely measured, and whose whole job is serving the
// room. Capping it would push people into a cascade the direct mesh could have
// carried, which is the opposite of what any of this is for.
function freeSlots(n: WorkNode): number {
  return n.isRoot ? Number.POSITIVE_INFINITY : MAX_CHILDREN_PER_RELAY - n.usedChildren;
}

function slotsFor(n: WorkNode, tier: QualityTier, multiplier: number): number {
  const perChildUp = uploadKbps(tier, multiplier);
  const perChildEnc = encodeMpxs(tier);
  if (perChildUp <= 0 || perChildEnc <= 0) return 0;
  const byUpload = Math.floor(freeUpload(n) / perChildUp);
  const byEncode = Math.floor(
    (n.encodeMpxs * trust(n) * ENCODE_HEADROOM - n.usedEncodeMpxs) / perChildEnc
  );
  return Math.max(0, Math.min(byUpload, byEncode, freeSlots(n)));
}

/**
 * Builds a delivery plan for one broadcaster.
 *
 * `contentMultiplier` must be the *measured* cost of the content (see
 * mediaStats), not a preset guess: the same "1080p60" label costs an eighth
 * as much for a static IDE as for a 60fps game, and planning against the
 * label is how a room ends up promising quality it cannot deliver.
 */
export function planTopology(
  root: PlannerNode,
  viewers: PlannerViewer[],
  contentMultiplier: number,
  // Who is serving whom right now, as childId -> parentId. Purely an
  // optimisation target: a plan that keeps someone where they are is worth
  // more than an equivalent plan that moves them. See allocate's parent sort.
  currentParents?: ReadonlyMap<string, string>
): TopologyPlan {
  // Each downgrade level is a *fresh* allocation, not a continuation of the
  // previous one. Continuing was subtly wrong: the greedy pass would let the
  // first few viewers consume the entire budget at full quality, and then
  // dropping the room a tier freed nothing, because the capacity was already
  // spent. Everyone after them simply went unserved. Re-running from scratch
  // at the lower tier is what actually makes the room fit.
  let best: TopologyPlan | null = null;
  for (let downgrade = 0; downgrade < TIERS.length; downgrade += 1) {
    const attempt = allocate(root, viewers, contentMultiplier, downgrade, currentParents);
    if (attempt.unserved.length === 0) return attempt;
    // Keep whichever attempt reaches the most people, in case even the
    // lowest tier cannot cover everyone.
    if (!best || attempt.edges.length > best.edges.length) best = attempt;
  }
  return best as TopologyPlan;
}

function allocate(
  root: PlannerNode,
  viewers: PlannerViewer[],
  contentMultiplier: number,
  globalDowngrade: number,
  currentParents?: ReadonlyMap<string, string>
): TopologyPlan {
  const nodes = new Map<string, WorkNode>();
  nodes.set(root.id, {
    ...root,
    usedUploadKbps: 0,
    usedEncodeMpxs: 0,
    usedChildren: 0,
    depth: 0,
    served: true,
    isRoot: true,
  });
  for (const v of viewers) {
    nodes.set(v.id, {
      ...v,
      usedUploadKbps: 0,
      usedEncodeMpxs: 0,
      usedChildren: 0,
      depth: -1,
      served: false,
      isRoot: false,
    });
  }

  const edges: PlanEdge[] = [];
  const wanted = new Map(viewers.map((v) => [v.id, v.wantTier]));
  // Who is relaying right now. Keeping the same people in the job is worth as
  // much as keeping the same people under them: which nodes get promoted was
  // decided purely by free capacity, so a jitter of a few hundred kbps in the
  // reports could swap out half the relays — and every relay that loses the
  // job hands its whole subtree to somebody else, which is several viewers
  // reconnecting to fix a difference that was noise.
  const currentRelays = new Set(currentParents ? [...currentParents.values()] : []);
  // Most expensive first, so the strongest parent absorbs the fullscreen
  // viewers and relays are left with cheap grid tiles.
  const pending = [...viewers]
    .sort((a, b) => tierIndex(a.wantTier) - tierIndex(b.wantTier))
    .map((v) => v.id);

  while (pending.length > 0) {
    const parents = [...nodes.values()]
      .filter((n) => n.served && n.depth < MAX_DEPTH && (n.id === root.id || n.eligibleRelay))
      .sort(
        (a, b) =>
          // Shallower first, so the root fills up before anyone is promoted
          // and a second hop is only ever reached once a first one is full.
          // Sorting purely by free capacity could put a fresh, idle viewer
          // ahead of the root and start a cascade the root did not need.
          a.depth - b.depth ||
          // Then whoever is already doing the job, so the set of relays is not
          // reshuffled by noise (see currentRelays).
          Number(currentRelays.has(b.id)) - Number(currentRelays.has(a.id)) ||
          // Then whoever has actually proven what they can carry. An assumed
          // budget is already discounted (see trust()), but between two nodes
          // that still look similar, evidence wins.
          Number(b.measured) - Number(a.measured) ||
          freeUpload(b) - freeUpload(a) ||
          b.stableSeconds - a.stableSeconds ||
          b.encodeMpxs - a.encodeMpxs
      );

    let progressed = false;
    for (const parent of parents) {
      if (pending.length === 0) break;
      const childDepth = parent.depth + 1;
      if (childDepth > MAX_DEPTH) continue;

      // Whoever this parent was already serving goes first, so a plan that
      // could keep them takes that option before a stranger consumes the slot.
      //
      // This is the entire hysteresis mechanism, and without it the allocator
      // was free to redraw the tree from scratch every six seconds. Its inputs
      // move constantly — a capacity report every eight seconds, a want-tier on
      // every tile resize — and it is a pure greedy pass with no memory, so a
      // fractional change in someone's measured uplink could reshuffle who
      // serves whom across the whole room. Each reshuffle costs the moved
      // viewer a torn-down connection and a visibly blank tile, for no gain
      // whatsoever: the plan it moved to was no better, only different.
      if (currentParents) {
        pending.sort((a, b) => {
          const keepA = currentParents.get(a) === parent.id ? 0 : 1;
          const keepB = currentParents.get(b) === parent.id ? 0 : 1;
          return keepA - keepB;
        });
      }

      let i = 0;
      while (i < pending.length) {
        const childId = pending[i];
        const child = nodes.get(childId);
        if (!child) {
          pending.splice(i, 1);
          continue;
        }
        // Deeper hops are served one tier lower. This is not a penalty: it
        // cuts the relay's upload and encode cost, limits how much quality
        // compounding re-encodes can destroy, and matches who actually ends
        // up deep in the tree (grid tiles, not fullscreen viewers).
        const tier = stepDown(wanted.get(childId) ?? WORST_TIER, globalDowngrade + (childDepth - 1));
        if (slotsFor(parent, tier, contentMultiplier) < 1) {
          i += 1;
          continue;
        }
        parent.usedUploadKbps += uploadKbps(tier, contentMultiplier);
        parent.usedEncodeMpxs += encodeMpxs(tier);
        parent.usedChildren += 1;
        child.served = true;
        child.depth = childDepth;
        edges.push({ from: parent.id, to: childId, tier, depth: childDepth });
        pending.splice(i, 1);
        progressed = true;
      }
    }

    // Nothing more fits anywhere at this quality level. Stop; the caller
    // retries the whole allocation one tier lower, which is what keeps a weak
    // host from producing a plan that serves nobody — a 2-core laptop cannot
    // encode 1080p60 for anyone, and the right answer is that everybody
    // watches at 1080p30, not that a lucky few watch and the rest see nothing.
    if (!progressed) break;
  }

  const depth = edges.reduce((m, e) => Math.max(m, e.depth), 0);
  const relays = [...new Set(edges.filter((e) => e.depth > 1).map((e) => e.from))];
  const rootNode = nodes.get(root.id);

  return {
    edges,
    depth,
    relays,
    globalDowngrade,
    unserved: pending,
    rootUploadKbps: Math.round(rootNode?.usedUploadKbps ?? 0),
    rootEncodeMpxs: Math.round(rootNode?.usedEncodeMpxs ?? 0),
  };
}

/**
 * Cheap pre-check answering only "can the root serve everyone directly?".
 *
 * Run before planTopology on every peer-list change: when it returns true —
 * which, with per-viewer tiering, is the common case — the answer is plain
 * mesh and no plan needs building, no relay instructions need sending, and
 * nothing about the existing connections changes.
 */
export function fitsDirectMesh(
  root: PlannerNode,
  viewers: PlannerViewer[],
  contentMultiplier: number
): boolean {
  let up = 0;
  let enc = 0;
  for (const v of viewers) {
    up += uploadKbps(v.wantTier, contentMultiplier);
    enc += encodeMpxs(v.wantTier);
  }
  return up <= root.uploadKbps * UPLOAD_HEADROOM && enc <= root.encodeMpxs * ENCODE_HEADROOM;
}

/** Every child-to-parent edge in a plan, for feeding back as `currentParents`. */
export function parentsOf(plan: TopologyPlan | null): Map<string, string> {
  const parents = new Map<string, string>();
  for (const edge of plan?.edges ?? []) parents.set(edge.to, edge.from);
  return parents;
}

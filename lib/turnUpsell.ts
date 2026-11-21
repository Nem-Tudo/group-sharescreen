import { useSyncExternalStore } from "react";
import { isTurnAllowed, subscribeIceServers } from "./iceConfig";
import { trackFeatureEvent } from "./features";
import { secondsSince, TURN_COPY_EVENTS, TURN_COPY_FEATURE } from "./turnUpsellCopy";

// "A transmissão não carrega? Assine o Pro": raised when a stream we are
// receiving never connects while this account has no TURN (entitlement
// "dedicated_turn"). Without a relay, a viewer behind a strict NAT simply
// cannot reach some broadcasters — that is the one case where the plan
// would have fixed it, so it is the one case worth saying so.
//
// Process-wide rather than per room: the receiving connections live deep in
// useRoomMedia's per-channel hooks, and the notice is one banner per page.

// How long a receiving connection may sit unconnected before it counts —
// longer than a normal ICE negotiation, shorter than a person gives up.
export const TURN_UPSELL_DELAY_MS = 15_000;

let shown = false;
// Whether it was ever raised on this page — a call that had trouble is not
// the moment to ask for a review (see lib/appReview).
let raised = false;
let raisedAt = 0;
let recoveredCounted = false;
let dismissed = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

/** A receiving connection failed, or never connected, without TURN. */
export function reportUnreachablePeer() {
  if (shown || dismissed || isTurnAllowed()) return;
  shown = true;
  if (!raised) raisedAt = Date.now();
  raised = true;
  emit();
}

export function wasTurnUpsellRaised(): boolean {
  return raised;
}

/** When the notice first went up on this page (0 if it never did). */
export function turnUpsellRaisedAt(): number {
  return raisedAt;
}

/**
 * A receiving connection reached "connected". After the notice went up, that
 * means the stream came through without Pro after all — counted once per page
 * for turn-upsell-copy, so a wording that sells can be told apart from one
 * that merely shows up where the connection was about to recover anyway.
 */
export function reportPeerConnected() {
  if (!raised || recoveredCounted) return;
  recoveredCounted = true;
  trackFeatureEvent(TURN_COPY_EVENTS.recovered, { feature: TURN_COPY_FEATURE, value: secondsSince(raisedAt) });
}

// Left the page while the notice was still up: the stream never came and they
// did not buy — the "gave up" side of the experiment. Capture phase so this
// event is queued before lib/features' own pagehide listener sends the batch
// (at the target, capturing listeners run first).
if (typeof window !== "undefined") {
  window.addEventListener(
    "pagehide",
    () => {
      if (!shown || isTurnAllowed()) return;
      trackFeatureEvent(TURN_COPY_EVENTS.leftStuck, { feature: TURN_COPY_FEATURE, value: secondsSince(raisedAt) });
    },
    { capture: true }
  );
}

/** The person closed the notice: not again for this page. */
export function dismissTurnUpsell() {
  dismissed = true;
  shown = false;
  emit();
}

// Also told when the plan changes (setTurnAllowed), so subscribing hides it.
function subscribe(listener: () => void) {
  listeners.add(listener);
  const stopIce = subscribeIceServers(listener);
  return () => {
    listeners.delete(listener);
    stopIce();
  };
}

/** Whether the notice should be up right now. */
export function useTurnUpsell(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => shown && !isTurnAllowed(),
    () => false
  );
}

import { trackFeatureEvent } from "@/lib/features";

// Which offer sent somebody to the plans, so the sale can be credited to it:
// its button leaves a mark here, the pay buttons report the mark, and the API
// attributes the purchase from that report (see its proSourceStats).
//
// Per browser because a guest has no account yet: the plan page asks them to
// make one before they can pay.

const SOURCES = {
  streamSummary: {
    storageKey: "sharescreen:streamSummaryCtaAt",
    feature: "stream-end-summary",
    checkoutEvent: "stream_summary_checkout",
  },
  turnUpsell: {
    storageKey: "sharescreen:turnUpsellCtaAt",
    feature: "pro-turn-notice",
    checkoutEvent: "turn_upsell_checkout",
  },
};

const CHECKOUT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function noteProSourceCta(source: keyof typeof SOURCES) {
  try {
    window.localStorage.setItem(SOURCES[source].storageKey, String(Date.now()));
  } catch {
    // Storage refused: that sale just goes unattributed.
  }
}

/** Called by the pay buttons: counts only for the offers that sent this person. */
export function trackProSourceCheckout() {
  for (const { storageKey, feature, checkoutEvent } of Object.values(SOURCES)) {
    try {
      const at = Number(window.localStorage.getItem(storageKey));
      if (!at || Date.now() - at > CHECKOUT_WINDOW_MS) continue;
    } catch {
      return;
    }
    trackFeatureEvent(checkoutEvent, { feature });
  }
}

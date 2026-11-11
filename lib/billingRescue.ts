import type { PremiumState } from "./accountApi";

// The site's half of the API's billingRescue.ts: money about to be lost, and
// the nudge that tries to keep it. Each is an experiment created in the admin
// panel ("Features"); the API counts the exposure at the moment the situation
// happens (a Pix expiring, a card refused, a cancellation started), so the
// site only draws and reports clicks.

export const PIX_RECOVER_FEATURE = "pix-recover";
export const RENEWAL_RESCUE_FEATURE = "renewal-rescue";
export const CANCEL_SAVE_FEATURE = "cancel-save";
export const DOOR_CONTEXT_FEATURE = "pro-door-context";

export const BILLING_RESCUE_EVENTS = {
  pixShown: "pix_recover_shown",
  pixClick: "pix_recover_click",
  pixClose: "pix_recover_close",
  rescueShown: "rescue_shown",
  rescueCard: "rescue_card_click",
  rescuePix: "rescue_pix_click",
  rescueClose: "rescue_close",
  saveShown: "cancel_save_shown",
  saveAccept: "cancel_save_accept",
  saveDecline: "cancel_save_decline",
  doorSeen: "pro_door_ctx_seen",
} as const;

// ---------------------------------------------------------------------------
// The Pix code this browser last showed, so a lapsed one can be offered again

const PENDING_PIX_KEY = "sharescreen:pendingPix";
/** How long after a code lapsed it is still worth offering a new one. */
export const PIX_RECOVER_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

export interface PendingPix {
  planId: string;
  cycle: string | null;
  /** When the code shown stops being payable. */
  expiresAt: number;
  at: number;
}

export function rememberPendingPix(entry: Omit<PendingPix, "at">) {
  try {
    window.localStorage.setItem(PENDING_PIX_KEY, JSON.stringify({ ...entry, at: Date.now() }));
  } catch {
    // Storage refused: nothing to offer later, which is the old behaviour.
  }
}

export function clearPendingPix() {
  try {
    window.localStorage.removeItem(PENDING_PIX_KEY);
  } catch {
    // Nothing to clear.
  }
}

export function readPendingPix(): PendingPix | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PENDING_PIX_KEY) ?? "null") as Partial<PendingPix> | null;
    if (!parsed || typeof parsed.planId !== "string" || typeof parsed.expiresAt !== "number") return null;
    return {
      planId: parsed.planId,
      cycle: typeof parsed.cycle === "string" ? parsed.cycle : null,
      expiresAt: parsed.expiresAt,
      at: typeof parsed.at === "number" ? parsed.at : parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// A refused renewal

/** A card subscription still running whose last charge was refused. */
export function hasRefusedRenewal(premium: PremiumState | null | undefined): boolean {
  return Boolean(
    premium &&
      premium.method !== "pix" &&
      premium.lastRefusal &&
      premium.status !== "cancelled" &&
      // A first charge refused on a subscription that never started is the
      // checkout's own error, not a renewal at risk.
      premium.status !== "pending" &&
      premium.provider !== "admin"
  );
}

/** Whether the card can be swapped from the site (a Stripe subscription). */
export function canUpdateCard(premium: PremiumState | null | undefined): boolean {
  return Boolean(
    premium &&
      premium.method !== "pix" &&
      premium.provider === "stripe" &&
      premium.providerRef?.startsWith("sub_") &&
      premium.status !== "cancelled"
  );
}

const RESCUE_DISMISS_KEY = "sharescreen:rescueDismissedAt";
const RESCUE_SNOOZE_MS = 24 * 60 * 60 * 1000;

export function rescueSnoozed(): boolean {
  try {
    const at = Number(window.localStorage.getItem(RESCUE_DISMISS_KEY));
    return Boolean(at) && Date.now() - at < RESCUE_SNOOZE_MS;
  } catch {
    return false;
  }
}

export function snoozeRescue() {
  try {
    window.localStorage.setItem(RESCUE_DISMISS_KEY, String(Date.now()));
  } catch {
    // It comes back on the next page, which is the cost.
  }
}

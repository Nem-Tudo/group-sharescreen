"use client";

import { getAccountToken } from "./accountApi";
import type { PremiumState } from "./accountApi";
import { getSignalingHttpBase } from "./roomsApi";

// The subscription's client half. Four calls, and none of them decides
// anything: the price comes from the API, the checkout happens at Mercado
// Pago, and what an account is entitled to is computed server-side and
// arrives on the account itself (see Account.features). This file moves
// values around and nothing more — which is the property that makes the
// paywall worth having.

export type BillingCycle = "monthly" | "yearly";

/** One billing cycle of a plan, priced. */
export type PlanCycle = {
  cycle: BillingCycle;
  priceCents: number;
  priceLabel: string;
  pixPriceCents: number;
  pixPriceLabel: string;
  /** The struck-through price, or null when the plan is not on offer. */
  fullPriceCents: number | null;
  fullPriceLabel: string | null;
  /** Whole percent off, or 0 when there is no offer. */
  discountPercent: number;
  /** A year's price divided by twelve — the only fair way to compare cycles. */
  monthlyEquivalentLabel: string;
  /** What a single Pix charge buys, in days. */
  periodDays: number;
};

export type PremiumPlan = {
  id: string;
  title: string;
  description: string;
  /**
   * Which mark goes beside the name — resolved through
   * components/planIcons.tsx, never rendered raw. Always a string: the API
   * falls back to its default rather than sending an absent field.
   */
  iconId: string;
  /** Integer centavos, straight from the plan document. */
  priceCents: number;
  /** "R$ 4,99" — formatted by the API so every surface agrees on it. */
  priceLabel: string;
  /**
   * What one Pix charge costs. Equal to the monthly price unless the plan
   * document sets it apart (see the API's pixPriceCents), so a caller can
   * always render it without checking whether the two differ.
   */
  pixPriceCents: number;
  pixPriceLabel: string;
  currency: string;
  frequency: number;
  frequencyType: string;
  features: string[];
  /**
   * What each billing cycle costs, worked out by the API.
   *
   * Not derived here on purpose: the page shows a struck-through price and a
   * percentage, and those have to be the same numbers the checkout will
   * charge. Computing them twice is how a page ends up advertising a discount
   * the till does not give.
   *
   * Absent from an older API, which the page reads as "monthly only".
   */
  cycles?: PlanCycle[];
  /** Points credited the moment a charge is approved — every charge. */
  purchasePoints: number;
  /** Points credited per whole day the subscription stays active. */
  dailyPoints: number;
  /**
   * Whether a checkout can be started at all. False when an admin has taken
   * the plan off sale *or* when the deployment has no payment credentials —
   * the page shows the plan either way and hides only the button, since a
   * product that vanishes is a worse answer than one that says "em breve".
   */
  available: boolean;
};

function authHeaders(): Record<string, string> {
  const token = getAccountToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** The plan on offer. Public — no account needed to read a price tag. */
export async function fetchPremiumPlan(signal?: AbortSignal): Promise<PremiumPlan | null> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/premium/plan`, { signal });
    if (!res.ok) return null;
    return (await res.json()) as PremiumPlan;
  } catch {
    // An API that is down should leave the page readable rather than throwing
    // into a boundary: the caller renders a "não foi possível carregar" state.
    return null;
  }
}

/**
 * Every plan on sale, cheapest first.
 *
 * Falls back to the single-plan route on an older API, so the page keeps
 * working against a deployment that predates /premium/plans rather than
 * showing nothing at all.
 */
export async function fetchPremiumPlans(signal?: AbortSignal): Promise<PremiumPlan[]> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/premium/plans`, { signal });
    if (res.ok) {
      const data = (await res.json()) as { plans?: PremiumPlan[] };
      if (Array.isArray(data.plans) && data.plans.length > 0) return data.plans;
    }
  } catch {
    // Same reasoning as fetchPremiumPlan: a page that cannot reach the API
    // should still render.
  }
  const single = await fetchPremiumPlan(signal);
  return single ? [single] : [];
}

export type StartCheckoutResult =
  | { ok: true; checkoutUrl: string }
  /**
   * `needsEmail` means the API wants a billing address before it can build
   * the checkout — either the account has none on file, or Mercado Pago
   * rejected the one it was given. The page turns it into an input rather
   * than an error somebody can only stare at.
   */
  | { ok: false; error: string; needsEmail?: boolean };

/**
 * Starts a subscription and returns where to send the person.
 *
 * `email` is sent only when the API has asked for one, and is purely the
 * address Mercado Pago bills. Note what is *not* sent: the price and the
 * plan. Both are read from the database by the API and the buyer is read
 * from the token, so there is no parameter here that could change what
 * somebody is charged — which is why a modified client cannot buy premium
 * for a cent. *
 * `planId` names which plan to buy and defaults to the one the site has always
 * sold, so every existing caller is unchanged. It is only a *selector*: the
 * price still comes from the plan document on the server, and an id the server
 * does not recognise falls back to that same default rather than buying
 * something cheaper (see the API's requestedPlanId).
 */
export async function startPremiumCheckout(
  email?: string,
  planId?: string,
  cycle?: BillingCycle
): Promise<StartCheckoutResult> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/premium/subscribe`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(email ? { email } : {}),
        ...(planId ? { planId } : {}),
        ...(cycle ? { cycle } : {}),
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      checkoutUrl?: string;
      error?: string;
      needsEmail?: boolean;
    };
    if (!res.ok || !data.checkoutUrl) {
      return {
        ok: false,
        error: data.error ?? "Não foi possível iniciar o pagamento.",
        needsEmail: data.needsEmail,
      };
    }
    return { ok: true, checkoutUrl: data.checkoutUrl };
  } catch {
    return { ok: false, error: "Sem conexão com o servidor." };
  }
}

export type PixCharge = {
  paymentId: string;
  /** The copy-and-paste Pix string. */
  qrCode: string | null;
  /** The same code as a PNG, base64, for rendering inline. */
  qrCodeBase64: string | null;
  /** ISO-8601; after this the code no longer works. */
  expiresAt: string | null;
  amountLabel: string;
  /** How many days of access this charge buys. */
  days: number;
};

export type StartPixResult =
  | { ok: true; charge: PixCharge }
  | { ok: false; error: string; needsEmail?: boolean };

/**
 * Creates a Pix charge and returns the code to pay it with.
 *
 * Unlike the card path this buys a *fixed stretch of time* rather than
 * starting a recurring charge — Pix has no standing mandate, so there is
 * nothing to renew and nothing to cancel. Nothing is granted until Mercado
 * Pago confirms the money arrived; the QR is an invitation to pay. *
 * `planId` names which plan to buy and defaults to the one the site has always
 * sold, so every existing caller is unchanged. It is only a *selector*: the
 * price still comes from the plan document on the server, and an id the server
 * does not recognise falls back to that same default rather than buying
 * something cheaper (see the API's requestedPlanId).
 */
export async function startPixPayment(
  email?: string,
  planId?: string,
  cycle?: BillingCycle
): Promise<StartPixResult> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/premium/pix`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(email ? { email } : {}),
        ...(planId ? { planId } : {}),
        ...(cycle ? { cycle } : {}),
      }),
    });
    const data = (await res.json().catch(() => ({}))) as Partial<PixCharge> & {
      error?: string;
      needsEmail?: boolean;
    };
    if (!res.ok || !data.paymentId) {
      return {
        ok: false,
        error: data.error ?? "Não foi possível gerar o Pix.",
        needsEmail: data.needsEmail,
      };
    }
    return { ok: true, charge: data as PixCharge };
  } catch {
    return { ok: false, error: "Sem conexão com o servidor." };
  }
}

export type GiftCharge = PixCharge & {
  /** The API's id for the gift, which is what its status is polled by. */
  giftId: string;
  /**
   * The share code, for a gift bought without naming anybody — null when one
   * was named. It is the present: whoever holds it can redeem it, which is
   * why it only ever comes back to the account that paid.
   */
  code: string | null;
};

/**
 * Where a gift stands.
 *
 *   "pending"   — the QR is on screen and nobody has paid it.
 *   "paid"      — the money arrived. For a named gift this never appears; for
 *                 a code it is the resting state, waiting to be redeemed.
 *   "delivered" — the days are on somebody's account.
 */
export type GiftStatus = "pending" | "paid" | "delivered";

export type StartGiftResult =
  | { ok: true; charge: GiftCharge }
  | { ok: false; error: string; needsEmail?: boolean };

/**
 * Buys a plan for somebody else, and returns the Pix code to pay it with.
 *
 * Pix only, and that is the API's shape rather than an omission here: a card
 * buys a *recurring mandate* on whoever pays, which is not a thing anybody
 * means by "presentear" — see the API's premiumRoutes.
 *
 * Note what is not a parameter, same as everywhere else in this file: the
 * price. The plan and the cycle are selectors, the money is read from the plan
 * document by the server, and the recipient is validated there too — a client
 * cannot gift a cheaper plan by asking for one.
 */
export async function startGiftPix(options: {
  /**
   * Who gets it, when the buyer named somebody. Left out for a present bought
   * as a link — the API answers that one with a code instead, and whoever
   * opens the link decides who the recipient is.
   */
  toUserId?: string;
  planId: string;
  cycle: BillingCycle;
  email?: string;
}): Promise<StartGiftResult> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/premium/gift/pix`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(options.toUserId ? { toUserId: options.toUserId } : {}),
        planId: options.planId,
        cycle: options.cycle,
        ...(options.email ? { email: options.email } : {}),
      }),
    });
    const data = (await res.json().catch(() => ({}))) as Partial<GiftCharge> & {
      error?: string;
      needsEmail?: boolean;
    };
    if (!res.ok || !data.paymentId || !data.giftId) {
      return {
        ok: false,
        error: data.error ?? "Não foi possível gerar o Pix do presente.",
        needsEmail: data.needsEmail,
      };
    }
    return { ok: true, charge: data as GiftCharge };
  } catch {
    return { ok: false, error: "Sem conexão com o servidor." };
  }
}

/**
 * Whether a gift has landed yet.
 *
 * Its own call rather than a reading of /premium/status, because a gift
 * deliberately changes nothing about the buyer's account — the days go to
 * somebody else, and the buyer's screen has no other way to know they arrived.
 */
export async function fetchGiftStatus(
  giftId: string
): Promise<{ status: GiftStatus; code: string | null; deliveredAt: number | null } | null> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/premium/gift/${encodeURIComponent(giftId)}`, {
      headers: authHeaders(),
    });
    if (!res.ok) return null;
    return (await res.json()) as {
      status: GiftStatus;
      code: string | null;
      deliveredAt: number | null;
    };
  } catch {
    return null;
  }
}

/** One gift this account bought, for the list of them. */
export type PurchasedGift = {
  id: string;
  code: string | null;
  status: GiftStatus;
  planId: string;
  planTitle: string;
  days: number;
  /** Who ended up with it, or null while a code is still going spare. */
  toId: string | null;
  createdAt: number;
  deliveredAt: number | null;
};

/**
 * The presents this account has bought.
 *
 * The reason it exists is narrow and worth stating: a code is handed over once,
 * on the screen that confirms the payment, and without somewhere to read it
 * again a closed tab is money gone.
 */
export async function fetchMyGifts(signal?: AbortSignal): Promise<PurchasedGift[]> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/premium/gifts`, {
      headers: authHeaders(),
      signal,
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { gifts?: PurchasedGift[] };
    return Array.isArray(data.gifts) ? data.gifts : [];
  } catch {
    return [];
  }
}

/** Who sent a present, as the claim screen draws them. */
export type GiftSender = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  flags: string[];
  bot?: boolean;
  nameColor: string | null;
};

/** What a share code turns out to be worth. */
export type GiftCodeInfo = {
  code: string;
  status: GiftStatus;
  planId: string;
  planTitle: string;
  planIconId: string;
  planDescription: string;
  days: number;
  createdAt: number;
  from: GiftSender | null;
};

/**
 * What is behind a /gift/<code> link.
 *
 * Needs no account, deliberately: whoever follows a present is often not
 * registered yet, and asking them to sign up before saying what they were
 * given would be asking them to register for a surprise.
 */
export async function fetchGiftByCode(
  code: string,
  signal?: AbortSignal
): Promise<GiftCodeInfo | null> {
  try {
    const res = await fetch(
      `${getSignalingHttpBase()}/premium/gift/code/${encodeURIComponent(code)}`,
      { signal }
    );
    if (!res.ok) return null;
    return (await res.json()) as GiftCodeInfo;
  } catch {
    return null;
  }
}

/**
 * Why a redemption was refused, when it was.
 *
 * A machine-readable reason beside the sentence, because the screen says
 * something quite different for each — "you already have more than this" is
 * good news wearing a refusal — and matching on the sentence itself would
 * break the first time somebody rewords it.
 */
export type RedeemFailure =
  | "not_found"
  | "redeemed"
  | "higher_plan"
  | "card_subscription"
  | "account_required"
  | "unknown";

export type RedeemGiftResult =
  | { ok: true; planId: string; days: number; currentPeriodEnd: number }
  | { ok: false; error: string; reason: RedeemFailure };

/** Puts a code's days onto the account that is logged in right now. */
export async function redeemGiftCode(code: string): Promise<RedeemGiftResult> {
  try {
    const res = await fetch(
      `${getSignalingHttpBase()}/premium/gift/code/${encodeURIComponent(code)}/redeem`,
      { method: "POST", headers: authHeaders() }
    );
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      planId?: string;
      days?: number;
      currentPeriodEnd?: number;
      error?: string;
      reason?: RedeemFailure;
    };
    if (!res.ok || !data.ok) {
      return {
        ok: false,
        error: data.error ?? "Não foi possível resgatar agora.",
        reason: data.reason ?? "unknown",
      };
    }
    return {
      ok: true,
      planId: data.planId ?? "",
      days: data.days ?? 0,
      currentPeriodEnd: data.currentPeriodEnd ?? 0,
    };
  } catch {
    return { ok: false, error: "Sem conexão com o servidor.", reason: "unknown" };
  }
}

/**
 * This account's subscription, re-read from Mercado Pago by the API.
 *
 * Worth calling when the page loads after a checkout: the webhook that
 * confirms a payment and the browser coming back from Mercado Pago are two
 * independent races, and this is the one the person can see.
 */
export async function fetchPremiumStatus(): Promise<{
  premium: PremiumState | null;
  features: string[];
} | null> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/premium/status`, {
      headers: authHeaders(),
    });
    if (!res.ok) return null;
    return (await res.json()) as { premium: PremiumState | null; features: string[] };
  } catch {
    return null;
  }
}

/**
 * Cancels the recurring charge. Access continues until the end of the period
 * already paid for — the API keeps `currentPeriodEnd` for exactly that.
 */
export async function cancelPremium(): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/premium/cancel`, {
      method: "POST",
      headers: authHeaders(),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: data.error ?? "Não foi possível cancelar agora." };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Sem conexão com o servidor." };
  }
}

/** Whether a subscription is paying right now, for the account page's copy. */
export function isPremiumActive(premium: PremiumState | null | undefined): boolean {
  if (!premium) return false;
  // Pix is the paid stretch and nothing else — mirroring the API's
  // accountTier. `status` there describes the last charge that was synced,
  // which for somebody who generated a second QR is a charge they never paid;
  // reading it here is what made the page say "sem assinatura" to people with
  // weeks left.
  if (premium.method === "pix") return Date.now() < premium.currentPeriodEnd;
  if (premium.status === "pending") return false;
  return Date.now() < premium.currentPeriodEnd;
}

"use client";

import { getAccountToken } from "./accountApi";
import type { PremiumState } from "./accountApi";
import { getSignalingHttpBase } from "./roomsApi";
import { translate } from "@/lib/i18n";

// The subscription's client half. None of these calls decides anything: the
// price comes from the API, the checkout happens at the payment provider, and
// what an account is entitled to is computed server-side and arrives on the
// account itself (see Account.features). This file moves values around and
// nothing more — which is the property that makes the paywall worth having.
//
// Note what is deliberately absent: which provider. GoLive takes money through
// both Mercado Pago and Stripe (a rollout decides which, per account — see the
// API's paymentGateway.ts), and this file cannot tell them apart, because a
// client that could name its own till would be a client that could pick the
// one with the weakest checks. The only trace of it here is `qrCodeImageUrl`,
// which exists because the two hand over a QR code differently.

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

/**
 * The plan the pickers mark "Recomendado" — on /pro, in the Pro popup (the same
 * ProPanel) and in the gift popup. By id rather than a flag on the plan document:
 * it is a merchandising choice made on the site, not a property of what the plan
 * sells.
 */
export const RECOMMENDED_PLAN_ID = "premium_max";

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
  /**
   * Whether this reader may pay by Pix at all — the "assinatura sem Pix"
   * rollout, decided by the API from the account (see its
   * premiumExperiments.ts). Optional so an older API reads as "yes", which is
   * what every deployment before it did; the route refuses the charge anyway,
   * so this only decides whether a button somebody cannot use is drawn.
   */
  pixAvailable?: boolean;
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
   * The biggest file a subscriber may attach, in MiB — read from the plan's
   * document by the API, so the page quotes whatever the database says today.
   * Absent from an older API, which the page reads as "don't mention it".
   */
  uploadLimitMb?: number;
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
export async function fetchPremiumPlans(
  signal?: AbortSignal,
  options: {
    /**
     * Price the plans for the signed-in reader rather than for nobody.
     *
     * Whether Pix costs the plan's Pix price or the subscription's is an
     * experiment (see the API's pixPriceExperiment.ts), and only a buyer's
     * *own* Pix purchase is part of it. So only the page that sells somebody
     * their own plan asks for this — a gift is always charged the base price,
     * which is exactly what the signed-out list shows.
     */
    personal?: boolean;
  } = {}
): Promise<PremiumPlan[]> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/premium/plans`, {
      signal,
      headers: options.personal ? authHeaders() : undefined,
    });
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
   * the checkout — either the account has none on file, or the provider
   * rejected the one it was given. The page turns it into an input rather
   * than an error somebody can only stare at.
   */
  | { ok: false; error: string; needsEmail?: boolean };

/**
 * Starts a subscription and returns where to send the person.
 *
 * `email` is sent only when the API has asked for one, and is purely the
 * address the provider bills. Note what is *not* sent: the price and the
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
      lowerPlan?: boolean;
    };
    if (!res.ok || !data.checkoutUrl) {
      return {
        ok: false,
        error: data.lowerPlan
          ? translate("premiumApi.lowerPlanWhileHigherActive")
          : data.error ?? translate("premiumApi.couldNotStartThePayment"),
        needsEmail: data.needsEmail,
      };
    }
    return { ok: true, checkoutUrl: data.checkoutUrl };
  } catch {
    return { ok: false, error: translate("common.noConnectionToTheServer") };
  }
}

export type PixCharge = {
  paymentId: string;
  /** The copy-and-paste Pix string. */
  qrCode: string | null;
  /** The same code as a PNG, base64, for rendering inline. */
  qrCodeBase64: string | null;
  /**
   * The same code as a hosted image, when the provider hands over a link
   * instead of the bytes.
   *
   * Exactly one of this and `qrCodeBase64` is ever filled in, so the modal
   * renders whichever it was given (see PixChargeModal) rather than caring
   * which provider produced it.
   */
  qrCodeImageUrl?: string | null;
  /** ISO-8601; after this the code no longer works. */
  expiresAt: string | null;
  amountLabel: string;
  /** How many days of access this charge buys. */
  days: number;
};

/**
 * What a refused charge still lets the buyer do about it.
 *
 * `needsEmail` — the API wants a billing address before it can build the
 * charge, either because the account has none on file or because the provider
 * rejected the one it was given.
 * `needsTaxId` — the provider wants the payer's CPF or CNPJ. Asked for only
 * when it happens, never up front: most Pix charges never need one, and a
 * document field on a payment form is a form people abandon.
 *
 * Both turn an error somebody can only stare at into an input.
 */
export type PaymentPrompt = { needsEmail?: boolean; needsTaxId?: boolean };

export type StartPixResult =
  | { ok: true; charge: PixCharge }
  | ({ ok: false; error: string } & PaymentPrompt);

/**
 * Creates a Pix charge and returns the code to pay it with.
 *
 * Unlike the card path this buys a *fixed stretch of time* rather than
 * starting a recurring charge — Pix has no standing mandate, so there is
 * nothing to renew and nothing to cancel. Nothing is granted until the
 * provider confirms the money arrived; the QR is an invitation to pay. *
 * `planId` names which plan to buy and defaults to the one the site has always
 * sold, so every existing caller is unchanged. It is only a *selector*: the
 * price still comes from the plan document on the server, and an id the server
 * does not recognise falls back to that same default rather than buying
 * something cheaper (see the API's requestedPlanId).
 */
export async function startPixPayment(
  email?: string,
  planId?: string,
  cycle?: BillingCycle,
  taxId?: string
): Promise<StartPixResult> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/premium/pix`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(email ? { email } : {}),
        ...(planId ? { planId } : {}),
        ...(cycle ? { cycle } : {}),
        ...(taxId ? { taxId } : {}),
      }),
    });
    const data = (await res.json().catch(() => ({}))) as Partial<PixCharge> & {
      error?: string;
      needsEmail?: boolean;
      needsTaxId?: boolean;
      lowerPlan?: boolean;
    };
    if (!res.ok || !data.paymentId) {
      return {
        ok: false,
        error: data.lowerPlan
          ? translate("premiumApi.lowerPlanWhileHigherActive")
          : data.error ?? translate("premiumApi.couldNotGenerateThePix"),
        needsEmail: data.needsEmail,
        needsTaxId: data.needsTaxId,
      };
    }
    return { ok: true, charge: data as PixCharge };
  } catch {
    return { ok: false, error: translate("common.noConnectionToTheServer") };
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
  | ({ ok: false; error: string } & PaymentPrompt);

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
  /** The buyer's CPF or CNPJ, when the provider has asked for one. */
  taxId?: string;
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
        ...(options.taxId ? { taxId: options.taxId } : {}),
      }),
    });
    const data = (await res.json().catch(() => ({}))) as Partial<GiftCharge> & {
      error?: string;
      needsEmail?: boolean;
      needsTaxId?: boolean;
    };
    if (!res.ok || !data.paymentId || !data.giftId) {
      return {
        ok: false,
        error: data.error ?? translate("premiumApi.couldNotGenerateTheGiftS"),
        needsEmail: data.needsEmail,
        needsTaxId: data.needsTaxId,
      };
    }
    return { ok: true, charge: data as GiftCharge };
  } catch {
    return { ok: false, error: translate("common.noConnectionToTheServer") };
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
        error: data.error ?? translate("premiumApi.couldNotRedeemRightNow"),
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
    return { ok: false, error: translate("common.noConnectionToTheServer"), reason: "unknown" };
  }
}

export type UpgradeQuote = {
  currentPlanId: string;
  targetPlanId: string;
  cycle: BillingCycle;
  remainingDays: number;
  amountLabel: string;
  amountCents: number;
};

/**
 * Prices moving to a higher plan mid-cycle, without charging anything.
 *
 * Only ever a higher plan than the one already active — the API refuses
 * anything else, since a downgrade takes effect on its own at the next
 * renewal rather than being bought.
 */
export async function fetchUpgradeQuote(planId: string): Promise<UpgradeQuote | null> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/premium/upgrade/quote`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ planId }),
    });
    if (!res.ok) return null;
    return (await res.json()) as UpgradeQuote;
  } catch {
    return null;
  }
}

export type StartUpgradeResult =
  | { ok: true; charge: PixCharge & { remainingDays: number } }
  | ({ ok: false; error: string } & PaymentPrompt);

/**
 * Charges the prorated top-up for moving to a higher plan mid-cycle, and
 * returns the Pix code to pay it with.
 *
 * Access does not change until the charge is confirmed — same as every other
 * Pix charge in this file — and settling it swaps the plan without adding any
 * days: the point of a top-up over a fresh purchase is paying for exactly the
 * upgrade, not for another cycle.
 */
export async function startUpgradePix(
  planId: string,
  email?: string,
  taxId?: string
): Promise<StartUpgradeResult> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/premium/upgrade/pix`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ planId, ...(email ? { email } : {}), ...(taxId ? { taxId } : {}) }),
    });
    const data = (await res.json().catch(() => ({}))) as Partial<PixCharge> & {
      remainingDays?: number;
      error?: string;
      needsEmail?: boolean;
      needsTaxId?: boolean;
      lowerPlan?: boolean;
    };
    if (!res.ok || !data.paymentId) {
      return {
        ok: false,
        error: data.lowerPlan
          ? translate("premiumApi.lowerPlanWhileHigherActive")
          : data.error ?? translate("premiumApi.couldNotGenerateThePix"),
        needsEmail: data.needsEmail,
        needsTaxId: data.needsTaxId,
      };
    }
    return { ok: true, charge: { ...(data as PixCharge), remainingDays: data.remainingDays ?? 0 } };
  } catch {
    return { ok: false, error: translate("common.noConnectionToTheServer") };
  }
}

/**
 * Schedules the card mandate that takes over billing, at the new plan's full
 * price, the moment this account's current cycle runs out — so a card
 * subscriber who upgrades does not have to come back and resubscribe by hand
 * once the days the top-up bought them are spent.
 *
 * Card subscribers only: a Pix plan has no mandate to hand off to. Approving
 * the checkout this returns changes nothing about the account yet — the
 * provider charges nothing until the scheduled date, and it only actually
 * takes over once it produces its first real charge then.
 */
export async function startUpgradeSchedule(
  planId: string,
  email?: string
): Promise<StartCheckoutResult> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/premium/upgrade/subscribe`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ planId, ...(email ? { email } : {}) }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      checkoutUrl?: string;
      error?: string;
      needsEmail?: boolean;
      lowerPlan?: boolean;
    };
    if (!res.ok || !data.checkoutUrl) {
      return {
        ok: false,
        error: data.lowerPlan
          ? translate("premiumApi.lowerPlanWhileHigherActive")
          : data.error ?? translate("premiumApi.couldNotStartThePayment"),
        needsEmail: data.needsEmail,
      };
    }
    return { ok: true, checkoutUrl: data.checkoutUrl };
  } catch {
    return { ok: false, error: translate("common.noConnectionToTheServer") };
  }
}

/**
 * This account's subscription, re-read from its provider by the API.
 *
 * Worth calling when the page loads after a checkout: the webhook that
 * confirms a payment and the browser coming back from the checkout are two
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
/** The fixed answers to "por que está cancelando?", in the order they show. */
export const CANCEL_REASONS = [
  "too_expensive",
  "not_using",
  "missing_features",
  "technical_issues",
  "temporary",
  "found_alternative",
  "other",
] as const;

export type CancelReason = (typeof CANCEL_REASONS)[number];

/** The fixed answers to "com que frequência você usava?". */
export const CANCEL_USAGE = ["daily", "weekly", "monthly", "rarely", "never"] as const;

export type CancelUsage = (typeof CANCEL_USAGE)[number];

/**
 * How long a free-text answer has to be. Kept in step with the API's
 * MIN_TEXT_ANSWER by hand — it is one number, and the API refuses anything
 * shorter, so a disagreement shows up as a dialog that lets somebody press a
 * button the server then rejects.
 */
export const MIN_CANCEL_ANSWER = 10;

/**
 * Why somebody is leaving. Every field is required — see the API's
 * /premium/cancel, which refuses to cancel anything without them.
 */
export type CancelSurvey = {
  reason: CancelReason;
  /** Their own words, required only when the reason is "other". */
  reasonOther?: string;
  improvement: string;
  comeback: string;
  usage: CancelUsage;
};

/**
 * Ends the recurring charge, and files the survey that goes with it.
 *
 * The survey is not optional and this signature is where that starts: there is
 * no way to call this without answers, which is what stops a future caller
 * from quietly adding a second, frictionless cancel button.
 *
 * `missing` comes back naming the unanswered fields rather than a sentence, so
 * the dialog can send somebody back to the right step — matching on a
 * translated message is how that breaks the first time somebody rewords one.
 */
export async function cancelPremium(
  survey: CancelSurvey
): Promise<{ ok: boolean; error?: string; missing?: string[]; reauthRequired?: boolean }> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/premium/cancel`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(survey),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        missing?: string[];
        reauthRequired?: boolean;
      };
      return {
        ok: false,
        error: data.error ?? translate("common.couldNotCancelRightNow"),
        missing: data.missing,
        // The sign-in this needs is too old — see the API's requireRecentAuth.
        // The cancellation page answers it by showing the login step again.
        reauthRequired: data.reauthRequired,
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: translate("common.noConnectionToTheServer") };
  }
}

/**
 * Whether a higher plan is still running on top of the subscription — see
 * PremiumState.carriedPlan. Mirrors the API's accountStore.carriedPlanLive.
 */
export function isCarriedPlanLive(premium: PremiumState | null | undefined): boolean {
  return Boolean(premium?.carriedPlan && (premium.carriedUntil ?? 0) > Date.now());
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

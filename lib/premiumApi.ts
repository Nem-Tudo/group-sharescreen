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

export type PremiumPlan = {
  id: string;
  title: string;
  description: string;
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
 * for a cent.
 */
export async function startPremiumCheckout(email?: string): Promise<StartCheckoutResult> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/premium/subscribe`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(email ? { email } : {}),
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
 * Pago confirms the money arrived; the QR is an invitation to pay.
 */
export async function startPixPayment(email?: string): Promise<StartPixResult> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/premium/pix`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(email ? { email } : {}),
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
  if (premium.status === "pending") return false;
  return Date.now() < premium.currentPeriodEnd;
}

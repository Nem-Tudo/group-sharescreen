// Shared between the admin panel (which builds/sends one) and the sidebar
// partner-ad slot (PartnerCard.tsx, which renders whatever the server
// currently has active) — mirrors server/partnerStore.ts's `Partner`, minus
// the admin-only `weight`/`createdAt` fields a regular visitor never needs
// (see server/signaling.ts's publicPartner).
export type Partner = {
  id: string;
  title: string;
  description: string;
  imageUrl: string | null;
  buttonLabel: string;
  buttonUrl: string;
  backgroundColor: string | null;
  textColor: string | null;
  buttonBackgroundColor: string | null;
  buttonTextColor: string | null;
  // epoch ms; null = never expires. PartnerCard.tsx schedules a local timer
  // off this so an active ad disappears the instant it expires, without
  // waiting for a reload or a live socket update.
  expiresAt: number | null;
  // Optional watch-to-earn reward (see PartnerRewardModal.tsx) — null means
  // this ad has none. rewardPoints is only ever non-null alongside a
  // rewardVideoUrl (see server's parsePartnerBody, which enforces that
  // pairing on every write).
  rewardVideoUrl: string | null;
  rewardPoints: number | null;
  // Optional click-to-earn reward: points for clicking the ad's main button.
  // null means this ad has none; clickRewardPlacement is non-null exactly
  // when this is, and says where the button offers them (the reward-video
  // popup, the sidebar card, or both) — the button itself works everywhere
  // regardless.
  clickRewardPoints: number | null;
  clickRewardPlacement: PartnerClickRewardPlacement | null;
};

export type PartnerClickRewardPlacement = "video" | "card" | "both";

export type PartnerCardData = {
  id?: string;
  title: string;
  description: string;
  imageUrl?: string | null;
  buttonLabel: string;
  buttonUrl: string;
  backgroundColor?: string | null;
  textColor?: string | null;
  buttonBackgroundColor?: string | null;
  buttonTextColor?: string | null;
  expiresAt?: number | null;
  rewardVideoUrl?: string | null;
  rewardPoints?: number | null;
  clickRewardPoints?: number | null;
  clickRewardPlacement?: PartnerClickRewardPlacement | null;
};

export const FALLBACK_PARTNER: PartnerCardData = {
  title: "Anuncie aqui pra todo mundo!",
  description:
    "Esse site é visitado por mais de 50 mil pessoas por dia!\n\nAbra um ticket no meu Discord e vamos combinar um anúncio",
  buttonLabel: "Abrir ticket no Discord",
  buttonUrl: "https://go.nemtudo.me/golive-partner-nemtudodiscord",
  backgroundColor: "#111827",
  textColor: "#f4f4f5",
  buttonBackgroundColor: "#5865f2",
  buttonTextColor: "#ffffff",
};

export const EXAMPLE_PARTNER: PartnerCardData = {
  title: "Me segue no Twitter!",
  description:
    "Posto updates dos meus projetos, coisas aleatórias, coisas da vida, eventos, etc.\n\nSegue aí gay",
  buttonLabel: "Sou lindo e vou seguir",
  imageUrl:
    "https://cdn.nemtudo.me/f/nemtudo/MjAyNi8wOC8yMC9JTUFHRS8wMl8yOF8wMl9fMTc4NzIwMzY4MjQyNC02NzMxNDIwNTI.webp",
  buttonUrl: "https://go.nemtudo.me/golive-partner-twitter",
  backgroundColor: "#000000",
  textColor: "#ffffff",
  buttonBackgroundColor: "#ffffff",
  buttonTextColor: "#000000",
};

export async function fetchPartner(
  signal?: AbortSignal,
  currentId?: string | null
): Promise<PartnerCardData | null> {
  const query = currentId ? `?current=${encodeURIComponent(currentId)}` : "";
  const res = await fetch(`${getSignalingHttpBase()}/partner${query}`, { signal });
  if (!res.ok) throw new Error(`Falha ao carregar parceiro (status ${res.status})`);
  const data = (await res.json()) as { partner: PartnerCardData | null };
  return data.partner;
}

/** Whether an ad's click reward is offered in this particular spot. Takes the
 *  two fields loosely so callers holding a partially-typed ad (PartnerCard's
 *  own PartnerCardData, where everything reward-related is optional) can ask
 *  without widening their type. */
export function clickRewardAppliesTo(
  partner: {
    clickRewardPoints?: number | null;
    clickRewardPlacement?: PartnerClickRewardPlacement | null;
  },
  spot: "video" | "card"
): boolean {
  if (!partner.clickRewardPoints) return false;
  const placement = partner.clickRewardPlacement ?? "both";
  return placement === "both" || placement === spot;
}

// ---------------------------------------------------------------------------
// Watch-to-earn reward
// ---------------------------------------------------------------------------

import { getAccountToken } from "./accountApi";
import { getStoredGuestToken } from "./guestToken";
import { getSignalingHttpBase } from "./roomsApi";

// Claims a partner ad's reward for whoever is here — an account when there's
// one, otherwise this browser's guest identity, whose points the API holds
// under the guest token itself (see lib/guestPoints.ts). The server is the
// only real gate (one claim per identity per ad, per kind, see
// claimPersistedPartnerReward), but a visitor with neither token is rejected
// here before ever hitting it, since there'd be nobody for the server to
// credit. In practice that's only reachable before a name has been chosen:
// registering one is what mints the guest token.
async function claimPartnerReward(
  partnerId: string,
  endpoint: "claim-reward" | "claim-click-reward",
  anonymousMessage: string
): Promise<{ points: number | null }> {
  const token = getAccountToken() ?? getStoredGuestToken();
  if (!token) throw new Error(anonymousMessage);
  const res = await fetch(
    `${getSignalingHttpBase()}/partner/${encodeURIComponent(partnerId)}/${endpoint}`,
    { method: "POST", headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (data && typeof data === "object" && "error" in data && String(data.error)) || "Falha ao resgatar a recompensa.";
    throw new Error(message);
  }
  return data as { points: number | null };
}

/** Watch-to-earn: the reward for playing an ad's video through to the end. */
export function claimPartnerVideoReward(partnerId: string): Promise<{ points: number | null }> {
  return claimPartnerReward(
    partnerId,
    "claim-reward",
    "Escolha um nome para entrar antes de resgatar pontos assistindo."
  );
}

/** Click-to-earn: the reward for clicking an ad's main button. Independent
 *  of the video one above — collecting either says nothing about the other. */
export function claimPartnerClickReward(partnerId: string): Promise<{ points: number | null }> {
  return claimPartnerReward(
    partnerId,
    "claim-click-reward",
    "Escolha um nome para entrar antes de resgatar pontos clicando."
  );
}

// Per-browser hint only (see the server-side claim check above for the real
// gate) — lets PartnerCard hide the "Ganhar X Pontos" button for an ad this
// same browser already collected, without a request round trip on every
// render. Clearing site data just makes the button reappear; the claim
// itself still refuses to pay out twice.
const CLAIMED_KEY_PREFIX = "sharescreen:partnerRewardClaimed:";

export function hasClaimedPartnerRewardLocally(partnerId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(CLAIMED_KEY_PREFIX + partnerId) === "1";
  } catch {
    return false;
  }
}

export function markPartnerRewardClaimedLocally(partnerId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CLAIMED_KEY_PREFIX + partnerId, "1");
  } catch {
    // ignored - localStorage may be unavailable (private mode, quota, etc.)
  }
}

// The click reward's equivalent of the flag above, kept under its own key
// for the same reason the server keeps a separate claim set: the two rewards
// are independent, and one being collected must not hide the other.
const CLICK_CLAIMED_KEY_PREFIX = "sharescreen:partnerClickRewardClaimed:";

export function hasClaimedPartnerClickRewardLocally(partnerId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(CLICK_CLAIMED_KEY_PREFIX + partnerId) === "1";
  } catch {
    return false;
  }
}

export function markPartnerClickRewardClaimedLocally(partnerId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CLICK_CLAIMED_KEY_PREFIX + partnerId, "1");
  } catch {
    // ignored - localStorage may be unavailable (private mode, quota, etc.)
  }
}

// Separate from the claimed flag above: someone can watch a reward video all
// the way through, close the popup without clicking "Receber Recompensa",
// and reopen it later — this is what lets that reopen land already unlocked
// (see PartnerRewardModal's `previouslyCompleted`) instead of making them
// sit through the whole thing again just to claim what they already earned.
const COMPLETED_KEY_PREFIX = "sharescreen:partnerRewardCompleted:";

export function hasCompletedPartnerVideoLocally(partnerId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(COMPLETED_KEY_PREFIX + partnerId) === "1";
  } catch {
    return false;
  }
}

export function markPartnerVideoCompletedLocally(partnerId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(COMPLETED_KEY_PREFIX + partnerId, "1");
  } catch {
    // ignored - localStorage may be unavailable (private mode, quota, etc.)
  }
}

// How far into a reward video this browser has genuinely watched (see
// PartnerRewardModal's anti-skip tracking) — saved on close so reopening the
// popup resumes from there instead of the very start, without granting a
// skip ahead of what was actually watched.
const PROGRESS_KEY_PREFIX = "sharescreen:partnerRewardProgress:";

export function getStoredPartnerVideoProgress(partnerId: string): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(PROGRESS_KEY_PREFIX + partnerId);
    const parsed = raw ? Number(raw) : 0;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

export function setStoredPartnerVideoProgress(partnerId: string, seconds: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PROGRESS_KEY_PREFIX + partnerId, String(Math.floor(seconds)));
  } catch {
    // ignored - localStorage may be unavailable (private mode, quota, etc.)
  }
}

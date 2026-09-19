// Shared between the admin panel (which builds/sends one) and the sidebar
// partner-ad slot (PartnerCard.tsx, which renders whatever the server
// currently has active) — mirrors server/partnerStore.ts's `Partner`, minus
// the admin-only `weight`/`createdAt` fields a regular visitor never needs
// (see server/signaling.ts's publicPartner).
export type Partner = {
  id: string;
  title: string;
  description: string;
  // Whether the ad has long-form markdown copy for the reward popup. The text
  // itself isn't in this payload (it's pushed to every visitor, and the copy
  // can be large) — fetchPartnerExtendedDescription gets it when the popup
  // opens. Absent from an API that predates it.
  hasExtendedDescription?: boolean;
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
  hasExtendedDescription?: boolean;
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
  get title() { return translate("partner.advertiseHereForEveryoneToSee"); },
  get description() { return translate("partner.thisSiteIsVisitedByMore"); },
  get buttonLabel() { return translate("partner.openATicketOnDiscord"); },
  buttonUrl: "https://go.nemtudo.me/golive-partner-nemtudodiscord",
  backgroundColor: "#111827",
  textColor: "#f4f4f5",
  buttonBackgroundColor: "#5865f2",
  buttonTextColor: "#ffffff",
};

export const EXAMPLE_PARTNER: PartnerCardData = {
  get title() { return translate("partner.followMeOnTwitter"); },
  get description() { return translate("partner.iPostUpdatesAboutMyProjects"); },
  get buttonLabel() { return translate("partner.iMGorgeousAndILl"); },
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
  if (!res.ok) throw new Error(translate("partner.couldNotLoadPartnerStatusStatus", { status: res.status }));
  const data = (await res.json()) as { partner: PartnerCardData | null };
  return data.partner;
}

/** An ad's long-form markdown copy (see Partner.hasExtendedDescription), or
 *  null when it has none. */
export async function fetchPartnerExtendedDescription(
  partnerId: string,
  signal?: AbortSignal
): Promise<string | null> {
  const res = await fetch(
    `${getSignalingHttpBase()}/partner/${encodeURIComponent(partnerId)}/extended-description`,
    { signal }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { extendedDescription?: string | null };
  return data.extendedDescription || null;
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

import { useEffect, useSyncExternalStore } from "react";
import { getAccountToken, useAccountToken } from "./accountApi";
import { getStoredGuestToken, useGuestToken } from "./guestToken";
import { getSignalingHttpBase } from "./roomsApi";
import { translate } from "@/lib/i18n";

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
    const message = (data && typeof data === "object" && "error" in data && String(data.error)) || translate("common.couldNotRedeemTheReward");
    throw new Error(message);
  }
  return data as { points: number | null };
}

/** Watch-to-earn: the reward for playing an ad's video through to the end. */
export function claimPartnerVideoReward(partnerId: string): Promise<{ points: number | null }> {
  return claimPartnerReward(
    partnerId,
    "claim-reward",
    translate("partner.chooseANameToJoinBefore")
  );
}

/** Click-to-earn: the reward for clicking an ad's main button. Independent
 *  of the video one above — collecting either says nothing about the other. */
export function claimPartnerClickReward(partnerId: string): Promise<{ points: number | null }> {
  return claimPartnerReward(
    partnerId,
    "claim-click-reward",
    translate("partner.chooseANameToJoinBefore2")
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

// ---------------------------------------------------------------------------
// Whether this identity already collected an ad's rewards — the server's word
// ---------------------------------------------------------------------------
//
// The flags above live in one browser, so on their own they were wrong in
// both directions: a new device, or cleared storage, offered again what had
// already been paid (the claim then refused it), and another account signing
// in on the same browser was told it had nothing to collect. The API now says,
// per identity, from the same claim sets that stop a second payout (see its
// GET /partner/:id/reward-status), and that answer is what counts.
//
// The flags are kept as the answer for the moment before the server's arrives
// — this browser's last word on it, usually right — and are brought in line
// with the server whenever it answers, so the next load starts closer to the
// truth.

export type PartnerRewardKind = "video" | "click";
type RewardStatus = Record<PartnerRewardKind, boolean>;

// Keyed by identity and ad: a different account on the same tab is a
// different question with a different answer.
const rewardStatus = new Map<string, RewardStatus>();
const rewardStatusRequests = new Set<string>();
let rewardStatusSeq = 0;
const rewardStatusListeners = new Set<() => void>();

function notifyRewardStatus() {
  rewardStatusSeq += 1;
  for (const listener of rewardStatusListeners) listener();
}

function rewardIdentity(): string | null {
  return getAccountToken() ?? getStoredGuestToken();
}

function rewardStatusKey(identity: string, partnerId: string): string {
  return `${identity}|${partnerId}`;
}

/**
 * Whether whoever is here already collected this ad's reward of this kind:
 * the server's answer once it has come (see usePartnerRewardStatus), this
 * browser's flag until then.
 */
export function hasClaimedPartnerReward(partnerId: string, kind: PartnerRewardKind): boolean {
  const identity = rewardIdentity();
  const known = identity ? rewardStatus.get(rewardStatusKey(identity, partnerId)) : undefined;
  if (known) return known[kind];
  return kind === "video"
    ? hasClaimedPartnerRewardLocally(partnerId)
    : hasClaimedPartnerClickRewardLocally(partnerId);
}

/**
 * Records a claim that just went through (or that the server refused as
 * already made): the flag for next time, and the answer for this identity now.
 */
export function markPartnerRewardClaimed(partnerId: string, kind: PartnerRewardKind): void {
  if (kind === "video") markPartnerRewardClaimedLocally(partnerId);
  else markPartnerClickRewardClaimedLocally(partnerId);
  const identity = rewardIdentity();
  if (identity) {
    const key = rewardStatusKey(identity, partnerId);
    const known = rewardStatus.get(key) ?? { video: false, click: false };
    rewardStatus.set(key, { ...known, [kind]: true });
  }
  notifyRewardStatus();
}

function syncLocalFlag(partnerId: string, kind: PartnerRewardKind, claimed: boolean) {
  if (typeof window === "undefined") return;
  const prefix = kind === "video" ? CLAIMED_KEY_PREFIX : CLICK_CLAIMED_KEY_PREFIX;
  try {
    if (claimed) window.localStorage.setItem(prefix + partnerId, "1");
    else window.localStorage.removeItem(prefix + partnerId);
  } catch {
    // ignored - localStorage may be unavailable (private mode, quota, etc.)
  }
}

/** Asks the server, once per identity and ad for as long as the tab is open. */
function requestRewardStatus(partnerId: string): void {
  const identity = rewardIdentity();
  // Nobody here has collected anything, and nobody could: there is no one to
  // pay. The flags stand in, as they always did.
  if (!identity) return;
  const key = rewardStatusKey(identity, partnerId);
  if (rewardStatus.has(key) || rewardStatusRequests.has(key)) return;
  rewardStatusRequests.add(key);
  void fetch(`${getSignalingHttpBase()}/partner/${encodeURIComponent(partnerId)}/reward-status`, {
    headers: { Authorization: `Bearer ${identity}` },
  })
    .then(async (res) => {
      // An API from before the route, or one that could not check: keep going
      // by the flags rather than guess.
      if (!res.ok) return;
      const data = (await res.json().catch(() => null)) as Partial<RewardStatus> | null;
      if (!data || typeof data.video !== "boolean" || typeof data.click !== "boolean") return;
      // A claim made while this was in flight is newer than the answer.
      const known = rewardStatus.get(key);
      const status = { video: data.video || Boolean(known?.video), click: data.click || Boolean(known?.click) };
      rewardStatus.set(key, status);
      // Only while the same identity is still here: the flags are per
      // browser, and belong to whoever is signed in on it now.
      if (rewardIdentity() === identity) {
        syncLocalFlag(partnerId, "video", status.video);
        syncLocalFlag(partnerId, "click", status.click);
      }
      notifyRewardStatus();
    })
    .catch(() => {
      // Offline or refused: the flags answer, and the next mount asks again.
    })
    .finally(() => rewardStatusRequests.delete(key));
}

/**
 * Keeps a component showing the server's answer about this ad's rewards: asks
 * for it (once per identity and ad), and re-renders when it lands. Read the
 * answer with hasClaimedPartnerReward during render, as before.
 */
export function usePartnerRewardStatus(partnerId: string | null | undefined): void {
  // Both read every render — a hook behind `??` would only run some of the time.
  const accountToken = useAccountToken();
  const guestToken = useGuestToken();
  const identity = accountToken ?? guestToken;
  useSyncExternalStore(
    (listener) => {
      rewardStatusListeners.add(listener);
      return () => {
        rewardStatusListeners.delete(listener);
      };
    },
    () => rewardStatusSeq,
    () => 0
  );
  useEffect(() => {
    if (partnerId) requestRewardStatus(partnerId);
  }, [partnerId, identity]);
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

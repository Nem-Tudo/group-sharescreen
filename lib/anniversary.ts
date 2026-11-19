"use client";

import { trackFeatureEvent } from "@/lib/features";
import { getSignalingHttpBase } from "@/lib/roomsApi";

// GoLive's "3 meses" page (app/3-meses). The page itself always opens from
// its link; what sits behind the experiment is the way *in* — the pill on the
// home page (components/AnniversaryPill.tsx). Its reach and how far people
// scroll are read in the admin's Features tab.

export const ANNIVERSARY_FEATURE = "anniversary-3m";
export const ANNIVERSARY_PATH = "/3-meses";

export const ANNIVERSARY_EVENTS = {
  view: "anniv_view",
  promoClick: "anniv_promo_click",
  scrollHalf: "anniv_scroll_half",
  scrollEnd: "anniv_scroll_end",
  musicOn: "anniv_music_on",
  mascotClick: "anniv_mascot_click",
  share: "anniv_share",
  recapView: "anniv_recap_view",
  recapLogin: "anniv_recap_login",
  recapShare: "anniv_recap_share",
} as const;

export function trackAnniversary(name: (typeof ANNIVERSARY_EVENTS)[keyof typeof ANNIVERSARY_EVENTS]) {
  trackFeatureEvent(name, { feature: ANNIVERSARY_FEATURE });
}

/** The API's GET /public/stats/anniversary (sharescreen-api anniversaryRoutes.ts). */
export interface AnniversaryStats {
  at: number;
  startDay: string;
  accounts: number;
  signupsPerDay: number[];
  callHours: number;
  shareHours: number;
  micHours: number;
  groups: number | null;
  groupMembers: number | null;
  groupMessages: number | null;
  directMessages: number | null;
  dmCalls: number | null;
  dmCallHours: number | null;
  appInstalls: number | null;
}

export async function fetchAnniversaryStats(signal?: AbortSignal): Promise<AnniversaryStats> {
  const res = await fetch(`${getSignalingHttpBase()}/public/stats/anniversary`, { signal });
  if (!res.ok) throw new Error(`anniversary stats: ${res.status}`);
  const data = (await res.json()) as AnniversaryStats;
  if (typeof data.accounts !== "number" || !Array.isArray(data.signupsPerDay)) {
    throw new Error("anniversary stats: bad shape");
  }
  return data;
}

/** The API's GET /me/anniversary: the signed-in person's own recap. */
export interface AnniversaryRecap {
  at: number;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  joinedAt: number;
  accountNumber: number;
  accountsTotal: number;
  daysWithUs: number;
  callHours: number;
  shareHours: number;
  micHours: number;
  callPercent: number;
  sharePercent: number;
  micPercent: number;
  points: number;
  tier: string;
  devices: string[];
  friends: number;
  groups: number;
  ownedGroups: number;
  lastRoom: { handle: string | null; private: boolean } | null;
  groupMessages: number | null;
  topGroup: { name: string; iconUrl: string | null; messages: number } | null;
  directMessages: number | null;
  topFriend: { displayName: string; avatarUrl: string | null; messages: number } | null;
  calls: number | null;
  callMinutes: number | null;
}

export async function fetchMyAnniversary(token: string, signal?: AbortSignal): Promise<AnniversaryRecap> {
  const res = await fetch(`${getSignalingHttpBase()}/me/anniversary`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  if (!res.ok) throw new Error(`anniversary recap: ${res.status}`);
  return (await res.json()) as AnniversaryRecap;
}

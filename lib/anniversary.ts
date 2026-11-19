"use client";

import { trackFeatureEvent } from "@/lib/features";
import { getSignalingHttpBase } from "@/lib/roomsApi";

// Go Live's "3 meses" page (app/3-meses). The page itself always opens from
// its link; what sits behind the experiment is the way *in*: the pill on the
// home page (components/AnniversaryPill.tsx) and the one-time popup
// (components/AnniversaryPopup.tsx).
//
// Everything about the page is counted as events of the anniversary-3m
// feature, read in the admin's Features tab. Somebody outside the rollout
// still counts, in the "control" group, so the totals cover every visitor;
// the split by group says how much the pill and popup brought in.

export const ANNIVERSARY_FEATURE = "anniversary-3m";
export const ANNIVERSARY_PATH = "/3-meses";
/** The query parameter that says where a visit came from (see ANNIVERSARY_SOURCES). */
export const ANNIVERSARY_FROM_PARAM = "from";

export const ANNIVERSARY_EVENTS = {
  /** Every page load. */
  view: "anniv_view",
  promoClick: "anniv_promo_click",
  scrollHalf: "anniv_scroll_half",
  scrollEnd: "anniv_scroll_end",
  musicOn: "anniv_music_on",
  share: "anniv_share",
  ctaRoom: "anniv_cta_room",
  ctaDiscord: "anniv_cta_discord",
  compareDrag: "anniv_compare_drag",
  bugFix: "anniv_bug_fix",
  bugsAll: "anniv_bugs_all",
  recapView: "anniv_recap_view",
  recapEnd: "anniv_recap_end",
  recapLogin: "anniv_recap_login",
  recapShare: "anniv_recap_share",
  /** On leaving, value = seconds the page was visible. */
  time: "anniv_time",
  popupShow: "anniv_popup_show",
  popupClick: "anniv_popup_click",
  popupClose: "anniv_popup_close",
} as const;

/** Where a visit came from: anniv_from.<source>, once per page load. */
export const ANNIVERSARY_SOURCES = ["pill", "popup", "share", "recap", "site", "external", "direct"] as const;
export type AnniversarySource = (typeof ANNIVERSARY_SOURCES)[number];

/** Each scene reached: anniv_seen.<scene>, once per page load. */
export const ANNIVERSARY_SCENES = [
  "intro",
  "day0",
  "day1",
  "first72",
  "outage",
  "numbers",
  "recap",
  "timeline",
  "night",
  "bugs",
  "team",
  "finale",
] as const;

/** Time on the page, as milestones: anniv_stay.<mark>. */
export const ANNIVERSARY_STAY_MARKS: { mark: string; seconds: number }[] = [
  { mark: "30s", seconds: 30 },
  { mark: "1m", seconds: 60 },
  { mark: "3m", seconds: 180 },
  { mark: "5m", seconds: 300 },
];

/** Every event name the page can send, for the feature's "site events" list. */
export function anniversaryEventNames(): string[] {
  return [
    ...Object.values(ANNIVERSARY_EVENTS),
    ...ANNIVERSARY_SOURCES.map((s) => `anniv_from.${s}`),
    ...ANNIVERSARY_SCENES.map((s) => `anniv_seen.${s}`),
    ...ANNIVERSARY_STAY_MARKS.map((m) => `anniv_stay.${m.mark}`),
  ];
}

export function trackAnniversary(name: string, value?: number) {
  trackFeatureEvent(name, { feature: ANNIVERSARY_FEATURE, ...(value ? { value } : {}) });
}

/** The page's link, tagged with where it is being opened or shared from. */
export function anniversaryShareUrl(from: AnniversarySource, hash = ""): string {
  const origin = typeof window === "undefined" ? "https://golive.nemtudo.me" : window.location.origin;
  return `${origin}${anniversaryPath(from, hash)}`;
}

/** The same, as a path on this site (for a Link). */
export function anniversaryPath(from: AnniversarySource, hash = ""): string {
  return `${ANNIVERSARY_PATH}?${ANNIVERSARY_FROM_PARAM}=${from}${hash ? `#${hash}` : ""}`;
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
  /** Most connections held at once; absent from an API older than the live record. */
  peakSockets?: number;
  peakAt?: number | null;
  /** The server's clock when it answered (ages `at` without trusting this device's clock). */
  now?: number;
  /** Growth per second of each running total, keyed like the fields above. */
  rates?: Record<string, number>;
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

"use client";

import { useEffect } from "react";
import { trackFeatureEvent, useFeature } from "./features";
import { isPageHidden } from "./pageHidden";
import { getDesktopBridge } from "./desktop";
import { classifyShareTitle } from "./shareInterest";

// Personalised affiliate products (experiment "affiliate-personalized", user
// target). See the API's affiliateInterests.ts for the pick itself.
//
// What a person is into lives here, in this browser's localStorage, and
// nowhere else: minutes spent in rooms of each category (the room's own
// category, set by its owner), minutes broadcasting a window of a known game
// or app (lib/shareInterest.ts — the category only, never the title) and the
// tags of products clicked. Old activity
// fades (half-life of two weeks). The profile is recorded for everybody,
// since it never leaves the device by itself; only the personalised side of
// the experiment sends it, as a short hint on GET /partner. Nothing from any
// chat goes into it.
//
// Variants: "on" = personalised pick (sends p13n=1 and the hint). Control =
// the weighted pick everyone had before. Both sides count the same events, so
// the admin compares product_click / product_impression across them, and
// product_match_* say how often the slot showed somebody something of theirs.

export const AFFILIATE_PERSONALIZED_FEATURE = "affiliate-personalized";

export const AFFILIATE_PERSONALIZED_EVENTS = {
  /** A product shown that is tagged with this person's top interest. */
  matchView: "product_match_view",
  /** ...and clicked. */
  matchClick: "product_match_click",
  /** A share started whose window was recognised (its category went into the profile). */
  shareHit: "interest_share_hit",
  /** A share started that said nothing: a whole screen, or an app not on the list. */
  shareMiss: "interest_share_miss",
} as const;

// The same ids as the API's AFFILIATE_INTERESTS (room categories minus "outros").
const INTERESTS = [
  "gameplay",
  "conversa",
  "musica",
  "filmes",
  "estudos",
  "trabalho",
  "esportes",
  "programacao",
  "arte",
] as const;
const INTEREST_SET = new Set<string>(INTERESTS);

const STORAGE_KEY = "golive.affiliateInterests.v1";
const HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000;
// A click says more than a minute in a room: worth a quarter hour of it.
const CLICK_POINTS = 15;
// A minute broadcasting a game says more than a minute sitting in a room.
const SHARE_MINUTE_POINTS = 2;
// Below this much (decayed) activity the profile is too thin to say anything,
// and the slot gets the plain pick instead.
const MIN_TOTAL = 5;
// Interests under this share are noise, not taste.
const MIN_SHARE = 0.05;
const MAX_SENT = 5;

type Stored = { scores: Record<string, number>; at: number };

function read(now: number): Stored {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { scores: {}, at: now };
    const parsed = JSON.parse(raw) as Partial<Stored>;
    const at = typeof parsed.at === "number" ? parsed.at : now;
    const factor = Math.pow(0.5, Math.max(0, now - at) / HALF_LIFE_MS);
    const scores: Record<string, number> = {};
    for (const [id, value] of Object.entries(parsed.scores ?? {})) {
      if (INTEREST_SET.has(id) && typeof value === "number" && Number.isFinite(value) && value > 0) {
        const decayed = value * factor;
        if (decayed >= 0.01) scores[id] = decayed;
      }
    }
    return { scores, at: now };
  } catch {
    return { scores: {}, at: now };
  }
}

function add(points: Record<string, number>) {
  const now = Date.now();
  const stored = read(now);
  for (const [id, value] of Object.entries(points)) {
    if (!INTEREST_SET.has(id)) continue;
    stored.scores[id] = (stored.scores[id] ?? 0) + value;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Private window or full storage: this browser just stays unprofiled.
  }
}

/** The profile as shares that sum to 1, strongest first; null while too thin. */
export function interestShares(): [string, number][] | null {
  if (typeof window === "undefined") return null;
  const { scores } = read(Date.now());
  const total = Object.values(scores).reduce((sum, v) => sum + v, 0);
  if (total < MIN_TOTAL) return null;
  const shares = Object.entries(scores)
    .map(([id, v]) => [id, v / total] as [string, number])
    .filter(([, share]) => share >= MIN_SHARE)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_SENT);
  return shares.length ? shares : null;
}

/** GET /partner's `interests` hint: "gameplay:0.62,musica:0.21". */
export function interestQuery(): string | null {
  const shares = interestShares();
  return shares ? shares.map(([id, share]) => `${id}:${share.toFixed(2)}`).join(",") : null;
}

function topInterest(): string | null {
  return interestShares()?.[0]?.[0] ?? null;
}

const TICK_MS = 60 * 1000;

/**
 * One point per minute spent in a room of this category, while the tab is
 * on screen. For the watch room; a room with no category (or "outros", or a
 * private room, which never has one) records nothing.
 */
export function useRoomInterestTracking(category: string | null | undefined) {
  useEffect(() => {
    if (!category || !INTEREST_SET.has(category)) return;
    const timer = setInterval(() => {
      if (!isPageHidden()) add({ [category]: 1 });
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [category]);
}

/**
 * While this person broadcasts their screen, SHARE_MINUTE_POINTS a minute to
 * the category of the window being shared. In the desktop app the shell
 * classifies the window it was handed and answers the category alone; in a
 * browser the track's label is all there is (often the window's title in
 * Chromium, often nothing useful elsewhere). Counted whether or not this tab
 * is on screen: someone broadcasting a game is, by definition, in the game.
 */
export function useShareInterestTracking(stream: MediaStream | null | undefined) {
  const track = stream?.getVideoTracks()[0] ?? null;
  useEffect(() => {
    if (!track) return;
    let interest: string | null = null;
    let cancelled = false;
    const bridge = getDesktopBridge();
    const resolve = bridge?.sharedSourceInterest
      ? bridge.sharedSourceInterest().catch(() => null)
      : Promise.resolve(classifyShareTitle(track.label));
    void resolve.then((found) => {
      if (cancelled) return;
      interest = found && INTEREST_SET.has(found) ? found : null;
      trackFeatureEvent(interest ? AFFILIATE_PERSONALIZED_EVENTS.shareHit : AFFILIATE_PERSONALIZED_EVENTS.shareMiss);
    });
    const timer = setInterval(() => {
      if (interest && track.readyState === "live") add({ [interest]: SHARE_MINUTE_POINTS });
    }, TICK_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [track]);
}

/** `track` only where the slot is on screen (usePartnerAd). */
export function useAffiliatePersonalizedFeature(options: { track?: boolean } = {}) {
  return useFeature(AFFILIATE_PERSONALIZED_FEATURE, { track: options.track ?? false });
}

function matchesTop(productInterests: string[] | undefined): boolean {
  const top = topInterest();
  return Boolean(top && productInterests?.includes(top));
}

/** Called with every product impression, on both sides of the experiment. */
export function noteProductImpression(productInterests: string[] | undefined) {
  if (matchesTop(productInterests)) trackFeatureEvent(AFFILIATE_PERSONALIZED_EVENTS.matchView);
}

/** Called with every product click: counted, then added to the profile. */
export function noteProductClick(productInterests: string[] | undefined) {
  if (matchesTop(productInterests)) trackFeatureEvent(AFFILIATE_PERSONALIZED_EVENTS.matchClick);
  const tags = (productInterests ?? []).filter((id) => INTEREST_SET.has(id));
  if (tags.length) add(Object.fromEntries(tags.map((id) => [id, CLICK_POINTS / tags.length])));
}

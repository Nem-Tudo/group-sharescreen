"use client";

import { trackFeatureEvent, type FeatureEventTags } from "@/lib/features";

// "Uai, cê é aqui da região!" — a one-time popup for people within ~100 km of
// Santa Rita do Sapucaí, where Go Live is made: who makes it, and the deal
// with the shirt (stop someone wearing a Go Live shirt in the street, ask for
// the gift, get a month of Pro Ultra).
//
// Location is the visitor's IP, never the browser's geolocation prompt:
// first our own /api/where (Cloudflare's headers, no third party), and only
// when that has no coordinates, a public lookup from the browser (GeoJS,
// free, keyless, CORS open) — and only for people in Brazil or of unknown
// country. Nobody outside the experiment is located at all. The answer is
// kept in this browser for a while, so it is one lookup per browser, not per
// page.

export const REGIONAL_FEATURE = "regional-popup";

/** Where Go Live is made. */
export const REGIONAL_HQ = { lat: -22.2522, lng: -45.7033 };
/** How far still counts as "the region" (Pouso Alegre 24 km, Varginha 83, Alfenas 95; Poços 102 is out). */
export const REGIONAL_RADIUS_KM = 100;
/** Closer than this to the HQ is "you are in Santa Rita". */
export const REGIONAL_HOME_KM = 8;

export const REGIONAL_EVENTS = {
  /** The popup opened; value = km to Santa Rita. */
  show: "regional_popup_show",
  /** value (on ok, close, pro, login) = seconds it had been open. */
  ok: "regional_popup_ok",
  /** ✕, Esc or a click outside. */
  close: "regional_popup_close",
  share: "regional_popup_share",
  /** "O que vem no Pro Ultra?" */
  pro: "regional_popup_pro",
  /** Sign in / create an account, from the gift ticket. */
  login: "regional_popup_login",
  /** The creator's Instagram (@onemtudo). */
  instagram: "regional_popup_ig",
  /** Tried to close it during the first seconds' lock (once per opening). */
  early: "regional_popup_early",
  /** Left the page (tab closed, reload, another site) with it still open and nothing clicked; value = seconds open. */
  left: "regional_popup_left",
  /** A location lookup's outcome: where it came from, or that it failed. */
  geoCf: "regional_geo.cf",
  geoPublic: "regional_geo.geojs",
  geoFail: "regional_geo.fail",
  /** A location was found: inside the radius, or not. */
  near: "regional_geo.near",
  far: "regional_geo.far",
} as const;

export function regionalEventNames(): string[] {
  return Object.values(REGIONAL_EVENTS);
}

export function trackRegional(name: string, value?: number, tags?: FeatureEventTags) {
  trackFeatureEvent(name, { feature: REGIONAL_FEATURE, ...(value ? { value } : {}), ...(tags ? { tags } : {}) });
}

/** Attributes the card puts on every event (the API adds "platform"). The feature declares all three. */
export const REGIONAL_TAGS = ["city", "os", "platform"] as const;

// ---------------------------------------------------------------------------
// Distance

export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ---------------------------------------------------------------------------
// Locating

export type RegionalSpot = { lat: number; lng: number };

type Stored = { at: number; spot: RegionalSpot | null };

const GEO_KEY = "sharescreen:regional:geo";
/** A found position is good for two weeks (people move, ISPs re-route). */
const FOUND_TTL_MS = 14 * 24 * 60 * 60 * 1000;
/** "Could not tell" is asked again the next day. */
const MISSING_TTL_MS = 24 * 60 * 60 * 1000;
const PUBLIC_LOOKUP = "https://get.geojs.io/v1/ip/geo.json";

function readStored(): Stored | undefined {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(GEO_KEY) ?? "null") as Stored | null;
    if (!parsed || typeof parsed.at !== "number") return undefined;
    const ttl = parsed.spot ? FOUND_TTL_MS : MISSING_TTL_MS;
    if (Date.now() - parsed.at > ttl) return undefined;
    if (parsed.spot && !(Number.isFinite(parsed.spot.lat) && Number.isFinite(parsed.spot.lng))) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function store(spot: RegionalSpot | null) {
  try {
    window.localStorage.setItem(GEO_KEY, JSON.stringify({ at: Date.now(), spot } satisfies Stored));
  } catch {
    // Asked again on the next page; harmless.
  }
}

function toSpot(lat: unknown, lng: unknown): RegionalSpot | null {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) return null;
  // 0,0 is what a lookup says when it has nothing.
  if (la === 0 && ln === 0) return null;
  return { lat: Math.round(la * 100) / 100, lng: Math.round(ln * 100) / 100 };
}

async function fetchJson(url: string, signal: AbortSignal): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, { signal, cache: "no-store", credentials: "omit" });
    if (!res.ok) return null;
    const data = (await res.json()) as unknown;
    return data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** A fresh lookup's answer: remembered, and counted by where it came from and whether it is the region. */
function found(spot: RegionalSpot | null, source: string): RegionalSpot | null {
  store(spot);
  trackRegional(spot ? source : REGIONAL_EVENTS.geoFail);
  if (spot) {
    const km = Math.round(distanceKm(spot, REGIONAL_HQ));
    trackRegional(km <= REGIONAL_RADIUS_KM ? REGIONAL_EVENTS.near : REGIONAL_EVENTS.far, km);
  }
  return spot;
}

let inFlight: Promise<RegionalSpot | null> | null = null;

/**
 * This visitor's approximate position, or null when it cannot be told (or is
 * plainly abroad). Cached in this browser; concurrent callers share one lookup.
 */
export function locateVisitor(): Promise<RegionalSpot | null> {
  const stored = readStored();
  if (stored) return Promise.resolve(stored.spot);
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 8000);
    try {
      const own = await fetchJson("/api/where", controller.signal);
      const ownSpot = own ? toSpot(own.lat, own.lng) : null;
      if (ownSpot) return found(ownSpot, REGIONAL_EVENTS.geoCf);
      // Cloudflare knows the country even without coordinates: anywhere but
      // Brazil is not the region, and nobody's address goes to a third party.
      const country = own && typeof own.country === "string" ? own.country : null;
      if (country && country !== "BR") {
        store(null);
        return null;
      }
      const looked = await fetchJson(PUBLIC_LOOKUP, controller.signal);
      const lookedCountry = looked && typeof looked.country_code === "string" ? looked.country_code.toUpperCase() : null;
      if (lookedCountry && lookedCountry !== "BR") {
        store(null);
        return null;
      }
      return found(looked ? toSpot(looked.latitude, looked.longitude) : null, REGIONAL_EVENTS.geoPublic);
    } finally {
      window.clearTimeout(timer);
      inFlight = null;
    }
  })();
  return inFlight;
}

// ---------------------------------------------------------------------------
// Once per browser

const SEEN_KEY = "sharescreen:regional:popup";

export function regionalPopupSeen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) !== null;
  } catch {
    // Nowhere to remember it: never show, rather than show on every page.
    return true;
  }
}

export function markRegionalPopupSeen() {
  try {
    window.localStorage.setItem(SEEN_KEY, String(Date.now()));
  } catch {
    // Already treated as seen when storage is refused.
  }
}

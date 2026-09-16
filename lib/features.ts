"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { featureBucket, featureOverrideTag, featureVariantIndex } from "./featureHash";
import { getAccountToken } from "./accountApi";
import { getSignalingHttpBase } from "./roomsApi";
import { getDeviceId } from "./deviceId";
import { currentAnnouncementDevice } from "./announcement";
import { useAuth } from "./AuthContext";

// Feature rollouts on the site — Discord-experiment style.
//
// The API publishes every definition at GET /features and this module decides
// on its own, from the id: a hash, a comparison, no request per check (see
// featureHash.ts). The decision is a transcription of the API's decideFeature
// and must stay one.
//
//   const { variant, ready } = useFeature("pro-page-redesign");          // user
//   const { enabled } = useFeature("new-room-toolbar", { room: handle }); // room
//   const { enabled } = useFeature("group-threads", { group: groupId });  // group
//
//   trackFeatureEvent("pro_plan_click");                 // user
//   trackFeatureEvent("share_start", { room: handle });  // room + user
//
// A check counts as an *exposure* the first time it resolves in a session
// (pass { track: false } for a check that does not change what is shown).
// Client events must be on the API's CLIENT_FEATURE_EVENTS list.
//
// Administrators can force any feature on or off for themselves in the admin
// panel's "Features" tab; that lives in this browser only (see
// setLocalFeatureOverride).

export type FeatureTarget = "user" | "room" | "group";
export type FeaturePlatform = "desktop-browser" | "desktop-app" | "mobile-browser" | "mobile-app";

export interface PublicFeature {
  key: string;
  target: FeatureTarget;
  rolloutBp: number;
  variants: string[];
  /** One per treatment; empty means an even split (see featureHash). */
  weights?: number[];
  salt: string;
  requiredFlags: string[];
  platforms: FeaturePlatform[];
  includeGuests: boolean;
  enabled: boolean;
  overrides: Record<string, string>;
}

export interface FeatureDecision {
  variant: string | null;
  /** The stats group, or null when this id is not counted. */
  group: string | null;
  reason: "unknown" | "disabled" | "no-id" | "ineligible" | "override" | "local" | "rollout" | "control";
}

const CACHE_KEY = "sharescreen:features";
const LOCAL_OVERRIDES_KEY = "sharescreen:featureOverrides";
const REFRESH_MS = 5 * 60_000;
const TRACK_DELAY_MS = 2_000;

// ---------------------------------------------------------------------------
// The definitions

type Snapshot = { features: Map<string, PublicFeature>; loaded: boolean; version: number };

const EMPTY: Snapshot = { features: new Map(), loaded: false, version: 0 };
let snapshot: Snapshot = EMPTY;
const listeners = new Set<() => void>();
let started = false;

function setSnapshot(features: PublicFeature[], loaded: boolean, version: number) {
  snapshot = { features: new Map(features.map((f) => [f.key, f])), loaded, version };
  for (const listener of listeners) listener();
}

async function refresh(): Promise<void> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/features`);
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { features: PublicFeature[]; version: number };
    if (!Array.isArray(data.features)) throw new Error("bad payload");
    try {
      window.localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    } catch {
      // Storage refused — the in-memory copy still serves this page.
    }
    setSnapshot(data.features, true, data.version);
  } catch {
    // Unreachable API: whatever was cached keeps deciding, and "loaded"
    // turns true so nothing waits forever on a spinner.
    if (!snapshot.loaded) setSnapshot([...snapshot.features.values()], true, snapshot.version);
  }
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  // Last session's definitions first, so a returning visitor renders the
  // right side on the first paint instead of flashing the other one.
  try {
    const cached = JSON.parse(window.localStorage.getItem(CACHE_KEY) ?? "null") as {
      features?: PublicFeature[];
      version?: number;
    } | null;
    if (cached && Array.isArray(cached.features)) {
      snapshot = { features: new Map(cached.features.map((f) => [f.key, f])), loaded: false, version: cached.version ?? 0 };
    }
  } catch {
    // Unreadable cache — start empty.
  }
  void refresh();
  window.setInterval(() => {
    if (document.visibilityState === "visible") void refresh();
  }, REFRESH_MS);
}

function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  const off = subscribeLocalOverrides(listener);
  return () => {
    listeners.delete(listener);
    off();
  };
}

const getSnapshot = () => snapshot;
const getServerSnapshot = () => EMPTY;

/** Every definition the site knows right now (admin tools use this). */
export function useFeatureDefinitions(): Snapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// ---------------------------------------------------------------------------
// Local overrides (admins, this browser only)

let localOverrides: Record<string, string> | null = null;
const localListeners = new Set<() => void>();

function readLocalOverrides(): Record<string, string> {
  if (localOverrides) return localOverrides;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LOCAL_OVERRIDES_KEY) ?? "{}");
    localOverrides = parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    localOverrides = {};
  }
  return localOverrides;
}

function subscribeLocalOverrides(listener: () => void) {
  localListeners.add(listener);
  return () => localListeners.delete(listener);
}

export function getLocalFeatureOverrides(): Record<string, string> {
  if (typeof window === "undefined") return {};
  return readLocalOverrides();
}

/** Forces a feature for this browser. `null` removes the override; "off" forces it off. */
export function setLocalFeatureOverride(key: string, variant: string | null) {
  const next = { ...readLocalOverrides() };
  if (variant === null) delete next[key];
  else next[key] = variant;
  localOverrides = next;
  try {
    window.localStorage.setItem(LOCAL_OVERRIDES_KEY, JSON.stringify(next));
  } catch {
    // Kept for this page only.
  }
  // A new snapshot object so useSyncExternalStore re-renders every check.
  snapshot = { ...snapshot };
  for (const listener of localListeners) listener();
}

// ---------------------------------------------------------------------------
// Deciding

export interface FeatureContext {
  flags?: string[] | null;
  guest?: boolean;
  platform?: FeaturePlatform | null;
  /** Local admin overrides are honoured only when this is true. */
  admin?: boolean;
}

/** The API's decideFeature, against the published (hashed) overrides. */
export function decideFeature(
  feature: PublicFeature | undefined,
  id: string | null | undefined,
  context: FeatureContext
): FeatureDecision {
  if (!feature) return { variant: null, group: null, reason: "unknown" };

  if (context.admin) {
    const local = getLocalFeatureOverrides()[feature.key];
    if (local === "off") return { variant: null, group: null, reason: "local" };
    if (local && feature.variants.includes(local)) return { variant: local, group: null, reason: "local" };
  }

  if (!feature.enabled) return { variant: null, group: null, reason: "disabled" };
  if (!id) return { variant: null, group: null, reason: "no-id" };

  const override = feature.overrides[featureOverrideTag(feature.salt, id)];
  if (override) {
    if (override === "off") return { variant: null, group: null, reason: "override" };
    if (feature.variants.includes(override)) return { variant: override, group: null, reason: "override" };
  }

  if (feature.target === "user") {
    if (context.guest && !feature.includeGuests) return { variant: null, group: null, reason: "ineligible" };
    if (feature.requiredFlags.length > 0) {
      const flags = context.guest ? [] : context.flags ?? [];
      if (!feature.requiredFlags.every((flag) => flags.includes(flag))) {
        return { variant: null, group: null, reason: "ineligible" };
      }
    }
  }
  if (feature.platforms.length > 0 && (!context.platform || !feature.platforms.includes(context.platform))) {
    return { variant: null, group: null, reason: "ineligible" };
  }

  if (featureBucket(feature.salt, id) < feature.rolloutBp && feature.variants.length > 0) {
    const variant = feature.variants[featureVariantIndex(feature.salt, id, feature.variants.length, feature.weights)];
    return { variant, group: variant, reason: "rollout" };
  }
  return { variant: null, group: "control", reason: "control" };
}

function currentPlatform(): FeaturePlatform | null {
  if (typeof window === "undefined") return null;
  try {
    return currentAnnouncementDevice();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Reporting

type Exposure = { key: string; id?: string };
type ClientEvent = { name: string; room?: string; group?: string; value?: number };

const pendingExposures: Exposure[] = [];
const pendingEvents: ClientEvent[] = [];
let trackTimer: number | null = null;
const exposedThisSession = new Set<string>();

function scheduleTrack() {
  if (trackTimer !== null || typeof window === "undefined") return;
  trackTimer = window.setTimeout(() => {
    trackTimer = null;
    void sendTrack();
  }, TRACK_DELAY_MS);
}

async function sendTrack(keepalive = false) {
  if (pendingExposures.length === 0 && pendingEvents.length === 0) return;
  const exposures = pendingExposures.splice(0, 40);
  const events = pendingEvents.splice(0, 40);
  const token = getAccountToken();
  try {
    await fetch(`${getSignalingHttpBase()}/features/track`, {
      method: "POST",
      keepalive,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ platform: currentPlatform(), deviceId: getDeviceId(), exposures, events }),
    });
  } catch {
    // Statistics — a lost batch is not worth a retry loop.
  }
  if (pendingExposures.length > 0 || pendingEvents.length > 0) scheduleTrack();
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => void sendTrack(true));
}

function reportExposure(key: string, target: FeatureTarget, id: string) {
  const dedupe = `${key}:${id}`;
  if (exposedThisSession.has(dedupe)) return;
  exposedThisSession.add(dedupe);
  pendingExposures.push(target === "user" ? { key } : { key, id });
  scheduleTrack();
}

/**
 * Something worth comparing between the sides of every feature it touches.
 * The user is always included (the API reads it from the session); pass a
 * room and/or group to count it for those features too.
 */
export function trackFeatureEvent(name: string, targets: { room?: string | null; group?: string | null; value?: number } = {}) {
  pendingEvents.push({
    name,
    ...(targets.room ? { room: targets.room } : {}),
    ...(targets.group ? { group: targets.group } : {}),
    ...(targets.value ? { value: targets.value } : {}),
  });
  scheduleTrack();
}

// ---------------------------------------------------------------------------
// The hook

export interface UseFeatureOptions {
  room?: string | null;
  group?: string | null;
  /** Count this check as an exposure (default true). */
  track?: boolean;
}

export interface FeatureState extends FeatureDecision {
  enabled: boolean;
  /**
   * False until the definitions (and, for user features, the account) are
   * known. Render a neutral state while false when showing the wrong side
   * for a moment would matter.
   */
  ready: boolean;
}

export function useFeature(key: string, options: UseFeatureOptions = {}): FeatureState {
  const definitions = useFeatureDefinitions();
  const { features, loaded } = definitions;
  const { account, loading } = useAuth();
  const feature = features.get(key);
  const target = feature?.target ?? "user";

  const guest = !account;
  const id =
    target === "user"
      ? account?.id ?? (loading ? null : getDeviceId())
      : target === "room"
        ? options.room ?? null
        : options.group ?? null;

  const flagsKey = account?.flags.join(",") ?? "";
  const admin = Boolean(account?.flags.includes("ADMIN"));
  const decision = useMemo(
    () =>
      decideFeature(feature, id, {
        flags: flagsKey ? flagsKey.split(",") : [],
        guest,
        platform: currentPlatform(),
        admin,
      }),
    // `definitions` is a new object on every refresh and on every local
    // override — the latter changes the answer without changing `feature`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [feature, id, flagsKey, guest, admin, definitions]
  );

  const ready = (loaded || Boolean(feature)) && (target !== "user" || !loading);
  const track = options.track !== false;

  useEffect(() => {
    if (!ready || !track || !feature || !id || decision.group === null) return;
    reportExposure(key, target, id);
  }, [ready, track, feature, id, decision.group, key, target]);

  return { ...decision, enabled: decision.variant !== null, ready };
}

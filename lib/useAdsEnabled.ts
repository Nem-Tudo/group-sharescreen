"use client";

import { useEffect, useState } from "react";
import { useSignalingSelector } from "@/lib/useSignalingSelector";
import { selectAdsEnabled } from "@/lib/signalingSelectors";
import { getSignalingHttpBase } from "@/lib/roomsApi";

// The admin panel's on/off switch for ads (Monetag), as the site sees it. The
// API still calls the field `adsterraEnabled`.
//
// Two sources, and both are needed for the switch to behave the way somebody
// pressing it expects:
//
//   - HTTP, once, so a page that has just been opened knows the answer
//     without waiting for a socket. Most pages that carry a slot are not
//     rooms and may never open one at all.
//   - the live socket, so flipping the switch empties the slots on every open
//     tab immediately rather than on their next reload. That is the whole
//     point of it being a button instead of an environment variable.
//
// The socket wins whenever it has spoken, because it is the more recent of
// the two by construction — see signalingClient.ts's `adsConfigSeq` for how
// "has spoken" is told apart from "said nothing yet".

const CACHE_KEY = "sharescreen:adsEnabled";

function getStoredAdsEnabled(): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const item = window.localStorage.getItem(CACHE_KEY);
    if (item === "true") return true;
    if (item === "false") return false;
    return null;
  } catch {
    return null;
  }
}

function setStoredAdsEnabled(val: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CACHE_KEY, String(val));
  } catch {}
}

/** Shared across every hook instance: one request per page, not one per slot. */
let cachedEnabled: boolean | null = typeof window !== "undefined" ? getStoredAdsEnabled() : null;
let inflight: Promise<boolean | null> | null = null;
const listeners = new Set<(value: boolean | null) => void>();

export function updateCachedAdsEnabled(enabled: boolean): void {
  cachedEnabled = enabled;
  setStoredAdsEnabled(enabled);
  for (const listener of listeners) listener(enabled);
}

async function loadAdsConfig(): Promise<boolean | null> {
  if (cachedEnabled !== null) return cachedEnabled;
  if (!inflight) {
    inflight = (async () => {
      try {
        const res = await fetch(`${getSignalingHttpBase()}/ads/config`);
        if (!res.ok) return null;
        const data = (await res.json()) as { adsterraEnabled?: unknown };
        const result = typeof data.adsterraEnabled === "boolean" ? data.adsterraEnabled : null;
        if (result !== null) {
          cachedEnabled = result;
          setStoredAdsEnabled(result);
        }
        return result;
      } catch {
        // An API that is down: failing open on network error, but only after an actual failure.
        return true;
      } finally {
        inflight = null;
      }
    })();
    void inflight.then((value) => {
      if (value !== null) {
        cachedEnabled = value;
        setStoredAdsEnabled(value);
      }
      for (const listener of listeners) listener(value);
    });
  }
  return inflight;
}

/**
 * Whether ads are switched on.
 *
 * Checks live socket first, then fetched/cached state. While loading for the
 * first time ever with no cache, returns false so ads are not prematurely
 * injected before the server's setting is known.
 */
export function useAdsEnabled(): boolean {
  const live = useSignalingSelector(selectAdsEnabled);
  const [fetched, setFetched] = useState<boolean | null>(cachedEnabled);

  useEffect(() => {
    let active = true;
    const listener = (value: boolean | null) => {
      if (active) setFetched(value);
    };
    listeners.add(listener);
    void loadAdsConfig().then(listener);
    return () => {
      active = false;
      listeners.delete(listener);
    };
  }, []);

  // The socket's answer whenever there is one; the fetched one otherwise.
  if (live !== null) return live;
  if (fetched !== null) return fetched;
  if (cachedEnabled !== null) return cachedEnabled;
  return false;
}

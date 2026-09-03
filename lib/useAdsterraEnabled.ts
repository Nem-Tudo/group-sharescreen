"use client";

import { useEffect, useState } from "react";
import { useSignaling } from "@/lib/useSignaling";
import { getSignalingHttpBase } from "@/lib/roomsApi";

// The admin panel's on/off switch for the Adsterra slots, as the site sees it.
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

/** Shared across every hook instance: one request per page, not one per slot. */
let cachedEnabled: boolean | null = null;
let inflight: Promise<boolean | null> | null = null;
const listeners = new Set<(value: boolean | null) => void>();

async function loadAdsConfig(): Promise<boolean | null> {
  if (cachedEnabled !== null) return cachedEnabled;
  if (!inflight) {
    inflight = (async () => {
      try {
        const res = await fetch(`${getSignalingHttpBase()}/ads/config`);
        if (!res.ok) return null;
        const data = (await res.json()) as { adsterraEnabled?: unknown };
        return typeof data.adsterraEnabled === "boolean" ? data.adsterraEnabled : null;
      } catch {
        // An API that is down leaves this null, which the caller reads as
        // "on". Failing open on purpose: a site that hides its advertising
        // whenever a config request fails would lose revenue to every
        // transient network error, and the switch is not a safety control.
        return null;
      } finally {
        inflight = null;
      }
    })();
    void inflight.then((value) => {
      if (value !== null) cachedEnabled = value;
      for (const listener of listeners) listener(value);
    });
  }
  return inflight;
}

/**
 * Whether the Adsterra slots are switched on.
 *
 * Returns true until told otherwise — see loadAdsConfig on why the failure
 * direction is "show them".
 */
export function useAdsterraEnabled(): boolean {
  const { adsterraEnabled: live } = useSignaling();
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
  return fetched !== false;
}

"use client";

import { useEffect, useState } from "react";

// "Is the site known to be broken right now?", asked once a minute.
//
// The answer comes from a file the operator edits (see app/api/status/route.ts
// for the feed and why it is proxied), which is the point: it works when the
// API does not. Nothing here talks to the API, the socket, or anything else
// that an outage would take with it — if it did, the banner would go dark
// exactly when it is supposed to appear.

export interface SiteStatus {
  apiError: boolean;
  message: string;
  button: { label: string; href: string; newTab: boolean } | null;
}

const NONE: SiteStatus = { apiError: false, message: "", button: null };

/** How often to ask. */
const POLL_MS = 60_000;

async function fetchStatus(signal: AbortSignal): Promise<SiteStatus | null> {
  try {
    const res = await fetch("/api/status", { signal, cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<SiteStatus>;
    if (data.apiError !== true || typeof data.message !== "string" || !data.message) return NONE;
    return {
      apiError: true,
      message: data.message,
      button:
        data.button && typeof data.button.href === "string" && typeof data.button.label === "string"
          ? { label: data.button.label, href: data.button.href, newTab: Boolean(data.button.newTab) }
          : null,
    };
  } catch {
    // null, not NONE: "I could not ask" and "there is no outage" are different
    // answers, and the caller keeps the last real one rather than clearing the
    // banner on a single failed poll.
    return null;
  }
}

export function useSiteStatus(): SiteStatus {
  const [status, setStatus] = useState<SiteStatus>(NONE);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      const next = await fetchStatus(controller.signal);
      if (controller.signal.aborted) return;
      if (next) setStatus(next);
      timer = setTimeout(() => void tick(), POLL_MS);
    };

    void tick();

    // A tab left in the background has its timers throttled to minutes by
    // every browser, so somebody coming back to a tab they opened this
    // morning would be reading a status from this morning. Asking on the way
    // back in is what makes the first thing they see current.
    const onVisible = () => {
      if (document.visibilityState === "visible") void fetchStatus(controller.signal).then((next) => {
        if (!controller.signal.aborted && next) setStatus(next);
      });
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return status;
}

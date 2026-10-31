"use client";

import { useEffect, useRef } from "react";
import useNtPopups from "ntpopups";
import { useAuth } from "@/lib/AuthContext";
import { accountTierOf } from "@/lib/entitlements";
import { trackFeatureEvent, useFeature } from "@/lib/features";

// The summary shown after a long broadcast ends, with the Pro offer (see
// components/StreamEndSummaryModal). After the stream rather than during it:
// nobody is interrupted, and it is the moment the numbers mean something.

/** The feature's key in the admin panel. Target: user. */
export const STREAM_SUMMARY_FEATURE = "stream-end-summary";

export const STREAM_SUMMARY_EVENTS = {
  show: "stream_summary_show", // value: minutes transmitted
  cta: "stream_summary_cta",
  // Pressed pay after arriving from the summary. The API attributes the sale
  // from this one: stream_summary_purchase, on the account (streamSummaryStats).
  checkout: "stream_summary_checkout",
  close: "stream_summary_close",
  never: "stream_summary_never",
};

// When the summary's button was last pressed. Per browser because a guest has
// no account yet: the plan page asks them to make one before they can pay.
const CTA_AT_KEY = "sharescreen:streamSummaryCtaAt";
const CHECKOUT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function noteStreamSummaryCta() {
  try {
    window.localStorage.setItem(CTA_AT_KEY, String(Date.now()));
  } catch {
    // Storage refused: that sale just goes unattributed.
  }
}

/** Called by the pay buttons: counts only for whoever came from the summary. */
export function trackStreamSummaryCheckout() {
  try {
    const at = Number(window.localStorage.getItem(CTA_AT_KEY));
    if (!at || Date.now() - at > CHECKOUT_WINDOW_MS) return;
  } catch {
    return;
  }
  trackFeatureEvent(STREAM_SUMMARY_EVENTS.checkout, { feature: STREAM_SUMMARY_FEATURE });
}

// "Não mostrar de novo". Per browser, like the room's other switches: a guest
// has no account to keep it on.
const HIDDEN_KEY = "sharescreen:streamSummaryHidden";

function summaryHidden(): boolean {
  try {
    return window.localStorage.getItem(HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function hideStreamSummary() {
  try {
    window.localStorage.setItem(HIDDEN_KEY, "1");
  } catch {
    // Storage refused: it just comes back on the next long broadcast.
  }
}

/** Without a usable `minMinutes` in the feature's public data. */
const DEFAULT_MIN_MINUTES = 10;

function minBroadcastMs(raw: unknown): number {
  const minutes = typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MIN_MINUTES;
  return minutes * 60 * 1000;
}

export type StreamSummaryPopupData = {
  durationSeconds: number;
  people: number;
  /** Everybody's time in the room during the broadcast, added up. */
  watchSeconds: number;
};

/**
 * `people`: who else is in the room right now, as stable ids. Counted once per
 * person across the whole broadcast, however often they come and go.
 */
export function useStreamEndSummary(active: boolean, people: readonly string[]) {
  const { account } = useAuth();
  const { openPopup } = useNtPopups();
  // Selling the plan to somebody who has one says nothing useful. A guest counts:
  // the Pro page asks them to create an account before buying.
  const eligible = !account || (!account.bot && accountTierOf(account.flags) === "account");
  const { enabled, data: featureData } = useFeature(STREAM_SUMMARY_FEATURE, { track: eligible && active });
  const minMs = minBroadcastMs(featureData.minMinutes);

  const startedAtRef = useRef<number | null>(null);
  const seenRef = useRef(new Set<string>());
  // The watch time. Time in the room rather than time looking at the stream,
  // which only each viewer could report: settled as people leave, so this does
  // nothing between one person coming or going and the next.
  const presentSinceRef = useRef(new Map<string, number>());
  const watchedMsRef = useRef(0);

  // Read by the ending below, which also has to run from an unmount (leaving
  // the room mid-broadcast ends it too) and so cannot depend on any of these.
  const finishRef = useRef<() => void>(() => {});
  useEffect(() => {
    finishRef.current = () => {
      const startedAt = startedAtRef.current;
      startedAtRef.current = null;
      if (startedAt === null || !eligible || !enabled || summaryHidden()) return;
      const now = Date.now();
      const elapsed = now - startedAt;
      if (elapsed < minMs) return;
      let watchedMs = watchedMsRef.current;
      for (const since of presentSinceRef.current.values()) watchedMs += now - since;
      trackFeatureEvent(STREAM_SUMMARY_EVENTS.show, {
        feature: STREAM_SUMMARY_FEATURE,
        value: Math.round(elapsed / 60000),
      });
      const data: StreamSummaryPopupData = {
        durationSeconds: Math.floor(elapsed / 1000),
        people: seenRef.current.size,
        watchSeconds: Math.floor(watchedMs / 1000),
      };
      openPopup("stream_summary", {
        width: "min(460px, calc(100vw - 30px))",
        maxWidth: "460px",
        data,
      });
    };
  }, [eligible, enabled, minMs, openPopup]);

  useEffect(() => {
    if (!active) return;
    startedAtRef.current = Date.now();
    seenRef.current = new Set();
    presentSinceRef.current = new Map();
    watchedMsRef.current = 0;
    return () => finishRef.current();
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const now = Date.now();
    const present = presentSinceRef.current;
    const here = new Set(people);
    for (const id of here) {
      seenRef.current.add(id);
      if (!present.has(id)) present.set(id, now);
    }
    for (const [id, since] of present) {
      if (here.has(id)) continue;
      watchedMsRef.current += now - since;
      present.delete(id);
    }
  }, [active, people]);
}

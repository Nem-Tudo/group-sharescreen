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
  close: "stream_summary_close",
};

/** Without a usable `minMinutes` in the feature's public data. */
const DEFAULT_MIN_MINUTES = 10;

function minBroadcastMs(raw: unknown): number {
  const minutes = typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MIN_MINUTES;
  return minutes * 60 * 1000;
}

export type StreamSummaryPopupData = {
  durationSeconds: number;
  people: number;
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

  // Read by the ending below, which also has to run from an unmount (leaving
  // the room mid-broadcast ends it too) and so cannot depend on any of these.
  const finishRef = useRef<() => void>(() => {});
  useEffect(() => {
    finishRef.current = () => {
      const startedAt = startedAtRef.current;
      startedAtRef.current = null;
      if (startedAt === null || !eligible || !enabled) return;
      const elapsed = Date.now() - startedAt;
      if (elapsed < minMs) return;
      trackFeatureEvent(STREAM_SUMMARY_EVENTS.show, {
        feature: STREAM_SUMMARY_FEATURE,
        value: Math.round(elapsed / 60000),
      });
      const data: StreamSummaryPopupData = {
        durationSeconds: Math.floor(elapsed / 1000),
        people: seenRef.current.size,
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
    return () => finishRef.current();
  }, [active]);

  useEffect(() => {
    if (!active) return;
    for (const id of people) seenRef.current.add(id);
  }, [active, people]);
}

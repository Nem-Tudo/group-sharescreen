"use client";

import { getAccountToken } from "./accountApi";
import { getSignalingHttpBase } from "./roomsApi";
import type { RoomThemeSpec } from "./roomThemes";
import { formatLocale } from "@/lib/i18n";

// The dashboard behind one theme, for the person who made it.
//
// Its own module rather than a corner of roomThemes: nothing here is needed to
// *wear* a theme, and the room — which imports that one on every join — has no
// business carrying a reporting client around.

export type ThemeReportRange = "24h" | "7d" | "30d";

export const THEME_REPORT_RANGES: { value: ThemeReportRange; label: string }[] = [
  { value: "24h", label: "24 h" },
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
];

export type ThemeReportBucket = {
  t: number;
  applies: number;
  removes: number;
  likes: number;
  buys: number;
};

export type ThemeReport = {
  theme: {
    id: string;
    name: string;
    description: string;
    spec: RoomThemeSpec;
    published: boolean;
    price: number;
    createdAt: number;
    updatedAt: number;
  };
  /** Counted at the moment of asking, from the accounts and rooms themselves. */
  live: { wearing: number; online: number; rooms: number };
  /** Kept on the theme as things happen — the people who are not here today. */
  totals: {
    adopters: number;
    applies: number;
    removes: number;
    likes: number;
    sales: number;
    earned: number;
    /** Of everybody who ever put it on, the share still wearing it. */
    retention: number | null;
  };
  window: {
    range: ThemeReportRange;
    step: "hour" | "day";
    /** Distinct people who put it on inside the window. */
    people: number;
    buckets: ThemeReportBucket[];
  };
};

export class ThemeReportDeniedError extends Error {}

export async function fetchThemeReport(
  id: string,
  range: ThemeReportRange,
  signal?: AbortSignal
): Promise<ThemeReport> {
  const token = getAccountToken();
  const res = await fetch(
    `${getSignalingHttpBase()}/themes/${encodeURIComponent(id)}/report?range=${range}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal }
  );
  // 401/403/404 are all the same thing to this page — "not yours to read" —
  // and are told apart from a dropped packet, which the poll should ride out
  // rather than blank the numbers for.
  if (res.status === 401 || res.status === 403 || res.status === 404) {
    throw new ThemeReportDeniedError("denied");
  }
  if (!res.ok) throw new Error("failed");
  return (await res.json()) as ThemeReport;
}

/** "1,2 mil" rather than "1200" once a number stops being worth reading exactly. */
export function formatPoints(value: number): string {
  return value.toLocaleString(formatLocale());
}

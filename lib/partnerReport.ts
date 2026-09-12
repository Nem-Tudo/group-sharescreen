import { getSignalingHttpBase } from "./roomsApi";
import { translate } from "@/lib/i18n";

// The public, link-only report for one partner ad (see the API's
// GET /partner-report/:token and app/ad/[token]). Everything here is
// read-only and unauthenticated by design: the token in the URL is the whole
// credential, so this module never touches the admin token — an advertiser
// holding a link is not an admin and must not need to be one.

export type PartnerReportRange = "24h" | "7d" | "30d";

export const PARTNER_REPORT_RANGES: { value: PartnerReportRange; label: string }[] = [
  { value: "24h", label: "24 horas" },
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
];

// One point of the time series. `t` is the epoch ms where the bucket *starts*,
// so a bucket labelled 14h covers 14:00–14:59 — the last one in the list is
// always the period in progress and is therefore expected to be short.
export type PartnerReportBucket = {
  t: number;
  views: number;
  sessionViews: number;
  clicks: number;
  clicksByVideo: number;
  minimizes: number;
  rewardVideoOpens: number;
  rewardVideoCompletions: number;
};

// Mirrors the API's partnerStatsSummaries. Kept here rather than imported from
// lib/adminApi so the public page pulls in none of the admin module — same
// numbers, different audience.
export type PartnerReportStats = {
  views: number;
  sessionViews: number;
  clicks: number;
  clicksByVideo: number;
  minimizes: number;
  rewardVideoOpens: number;
  rewardVideoCompletions: number;
  uniqueViews: number;
  rewardClaims: number;
  clickRewardClaims: number;
};

export type PartnerReportAd = {
  title: string;
  description: string;
  imageUrl: string | null;
  buttonLabel: string;
  buttonUrl: string;
  backgroundColor: string | null;
  textColor: string | null;
  buttonBackgroundColor: string | null;
  buttonTextColor: string | null;
  createdAt: number;
  expiresAt: number | null;
  rewardVideoUrl: string | null;
  rewardPoints: number | null;
  clickRewardPoints: number | null;
  clickRewardPlacement: "video" | "card" | "both" | null;
  // Whether the ad is being served right now — false once it is past its
  // expiry, which is why the page can say "encerrado" without the reader
  // having to compare two dates themselves.
  active: boolean;
};

export type PartnerReport = {
  ad: PartnerReportAd;
  stats: PartnerReportStats;
  history: {
    range: PartnerReportRange;
    step: "hour" | "day";
    buckets: PartnerReportBucket[];
  };
  // The server's clock at the moment it answered. Everything time-related on
  // the page is drawn against this rather than the browser's own Date.now(),
  // so a machine whose clock is off by minutes doesn't get a chart that ends
  // in the future.
  serverTime: number;
};

/** Thrown when the token doesn't match any ad — the page turns this into a
 *  "link inválido" screen rather than a generic failure, since it is the one
 *  error a reader can actually act on (ask for a new link). */
export class PartnerReportNotFoundError extends Error {
  constructor() {
    super(translate("partnerReport.reportNotFound"));
    this.name = "PartnerReportNotFoundError";
  }
}

export async function fetchPartnerReport(
  token: string,
  range: PartnerReportRange,
  signal?: AbortSignal
): Promise<PartnerReport> {
  // The viewer's UTC offset travels with the request so the server's daily
  // buckets break at the reader's midnight, not the server's.
  const tz = new Date().getTimezoneOffset();
  const res = await fetch(
    `${getSignalingHttpBase()}/partner-report/${encodeURIComponent(token)}?range=${range}&tz=${tz}`,
    { signal, cache: "no-store" }
  );
  if (res.status === 404) throw new PartnerReportNotFoundError();
  if (!res.ok) throw new Error(translate("partnerReport.couldNotLoadTheReportStatus", { status: res.status }));
  return (await res.json()) as PartnerReport;
}

/** Total clicks on the ad's button, wherever it was pressed. The two numbers
 *  are stored apart (a click from the sidebar card and one from inside the
 *  reward video are not the same act) and summed only for display. */
export function totalPartnerClicks(stats: {
  clicks: number;
  clicksByVideo: number;
}): number {
  return stats.clicks + stats.clicksByVideo;
}

/**
 * Click-through rate against distinct people, not against impressions.
 *
 * The sidebar slot rotates, so the same person can be served the same ad
 * several times in one sitting; a ratio whose denominator grows every five
 * minutes while nobody new arrives is a number that can only ever fall, which
 * would make a healthy campaign look like a failing one. Null while nobody has
 * been reached yet — 0% would claim a measurement that hasn't happened.
 */
export function partnerCtr(stats: PartnerReportStats): number | null {
  if (!stats.uniqueViews) return null;
  return (totalPartnerClicks(stats) / stats.uniqueViews) * 100;
}

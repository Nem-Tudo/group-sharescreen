// "Travou?" — the button a viewer presses on a tile the moment the picture
// stutters (experiment sq-stall-report). See the API's server/stallReports.ts
// for why the minute around a press says what the session reports cannot.
//
// The report is the tile's last minute from lib/pageHealth plus the
// receiving session's summary and last samples from lib/connectionTelemetry.
// Nothing is recorded for it beyond what those two already keep in memory.

import { recentReceiveSession } from "./connectionTelemetry";
import { pageHistory } from "./pageHealth";
import { getSignalingHttpBase } from "./roomsApi";
import { getAccountToken } from "./accountApi";
import { getStoredGuestToken } from "./guestToken";
import { signalingClient } from "./signalingClient";
import { isDesktopApp, isIOSApp, isMobileApp } from "./desktop";
import { trackFeatureEvent } from "./features";

export const STALL_REPORT_FEATURE = "sq-stall-report";

// stall_press        a press that was sent (tags: app, why)
// stall_render       ...the tile painted under half the frames it decoded in that minute
// stall_sender       ...frames were not arriving: the sender's side or the path
// stall_page         ...our page held the main thread for over a tenth of the minute
// stall_cpu          ...the CPU was under serious/critical pressure at some point
export const STALL_REPORT_EVENTS = {
  press: "stall_press",
  render: "stall_render",
  sender: "stall_sender",
  page: "stall_page",
  cpu: "stall_cpu",
} as const;

// Somebody pressing in anger presses several times; one report per picture
// every so often is plenty, and the API's rate limit is the wall behind it.
const MIN_GAP_MS = 20_000;
const lastSent = new Map<string, number>();

function browserName(ua: string): string {
  const m = /Edg\/(\d+)/.exec(ua) ?? /OPR\/(\d+)/.exec(ua) ?? /Firefox\/(\d+)/.exec(ua) ?? /Chrome\/(\d+)/.exec(ua);
  if (!m) return "other";
  const name = m[0].startsWith("Edg") ? "Edge" : m[0].startsWith("OPR") ? "Opera" : m[0].startsWith("Firefox") ? "Firefox" : "Chrome";
  return `${name} ${m[1]}`;
}

export type StallReportResult = "sent" | "too-soon" | "no-connection" | "failed";

/** Sends what the last minute of this picture looked like. */
export async function sendStallReport(channel: string, originId: string): Promise<StallReportResult> {
  const key = `${channel} ${originId}`;
  const now = Date.now();
  if (now - (lastSent.get(key) ?? 0) < MIN_GAP_MS) return "too-soon";
  const session = recentReceiveSession(channel, originId);
  if (!session) return "no-connection";
  lastSent.set(key, now);

  const seconds = pageHistory(channel, originId);
  const app = isIOSApp() ? "ios" : isMobileApp() ? "android" : isDesktopApp() ? "desktop" : "web";
  // A first reading of the minute, counted in the feature's events so the
  // admin answers "what were the presses" without a script.
  const counted = seconds.filter((s) => s.frames !== null);
  const painted = counted.reduce((sum, s) => sum + (s.frames ?? 0), 0);
  const decodedPerSecond = session.recent
    .filter((s) => !s.paused && s.intervalS > 0)
    .map((s) => s.fps ?? 0);
  const arriving = decodedPerSecond.length ? decodedPerSecond.reduce((a, b) => a + b, 0) / decodedPerSecond.length : null;
  const paintedPerSecond = counted.length ? painted / counted.length : null;
  const longTask = seconds.reduce((sum, s) => sum + s.longTaskMs, 0);
  const why: string[] = [];
  if (arriving !== null && paintedPerSecond !== null && arriving >= 10 && paintedPerSecond < arriving / 2) why.push("render");
  if (arriving !== null && arriving < 15) why.push("sender");
  if (longTask > seconds.length * 100) why.push("page");
  if (seconds.some((s) => s.pressure === "serious" || s.pressure === "critical")) why.push("cpu");

  const token = getAccountToken() ?? getStoredGuestToken();
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  const body = {
    roomId: session.roomId,
    channel,
    fromPeerId: session.peerId,
    toPeerId: signalingClient.state.selfId ?? "",
    senderUserId: session.peerUserId,
    app,
    browser: browserName(nav?.userAgent ?? ""),
    cores: nav?.hardwareConcurrency || null,
    summary: session.summary,
    seconds,
    samples: session.recent,
  };
  try {
    const res = await fetch(`${getSignalingHttpBase()}/telemetry/stall-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
      keepalive: true,
    });
    if (!res.ok) return "failed";
  } catch {
    return "failed";
  }
  const tags = { app, why: why[0] ?? "none" };
  trackFeatureEvent(STALL_REPORT_EVENTS.press, { feature: STALL_REPORT_FEATURE, tags });
  for (const reason of why) {
    trackFeatureEvent(STALL_REPORT_EVENTS[reason as keyof typeof STALL_REPORT_EVENTS], { feature: STALL_REPORT_FEATURE, tags: { app } });
  }
  return "sent";
}

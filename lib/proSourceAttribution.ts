import { trackFeatureEvent } from "@/lib/features";

// Which door somebody came through to the plans, so the sale can be credited
// to it: the door leaves a mark here, the pay buttons report the mark, and the
// API attributes the purchase from that report (see its proSourceStats).
//
// Per browser because a guest has no account yet: the plan page asks them to
// make one before they can pay.

// ---------------------------------------------------------------------------
// Every door (feature "pro-source")
//
// Last touch: the latest door wins, because it is the one that was in front of
// the person when they decided. Counted in a measurement-only feature (rollout
// 0, so everybody lands in its "control" column):
//
//   prosrc_open.<door>      the door was used (the plans opened from it)
//   prosrc_checkout.<door>  a pay button was pressed, with this door on record
//   prosrc_buy.<door>       (API) a plan was bought — `none` when no pay click
//   prosrc_new.<door>       (API) the same, from somebody who had never paid
//   prosrc_upg.<door>       (API) an upgrade top-up
//
// A door has to be in PRO_SOURCES *and* its open/checkout names in the
// feature's site events, or the event is dropped. `prosrc_checkout.` is 16
// characters and events stop at 40, so a door name stays under 24.

export const PRO_SOURCE_FEATURE = "pro-source";

export const PRO_SOURCES = [
  // The standing buttons.
  "header", // site header (SiteHeader)
  "me_screen", // the "Você" screen on a phone (MeScreen)
  "room_header", // the room's header button
  "room_menu", // the room's "⋯" menu on a phone
  "group_bar", // the group bar's button
  "group_menu", // the group's menu on a phone
  // Locks and offers: a thing the person tried, and the plan it needs.
  "ad_gate", // broadcast paused for an ad
  "stream_summary", // summary after a broadcast ends
  "turn_banner", // bad-connection notice, banner
  "turn_tile", // bad-connection notice, inside the tile
  "quality_select", // locked quality in the picker
  "multi_screen", // screen limit / its upgrade chip
  "multi_camera", // camera limit upgrade
  "room_theme", // room theme without the plan
  "group_theme", // group theme without the plan
  "aura", // group auras
  "emoji", // custom emoji manager
  "translation", // live translation
  "transcript", // call transcript
  "room_tools", // a locked room tool
  "camfx_others", // camera effect on somebody else
  "camfx_publish", // publishing a camera effect
  "camfx_custom_bg", // custom camera background
  "camfx_stream_bg", // stream as camera background
  "theme_hub", // themes dialog
  "theme_editor", // theme editor
  "profile_lock", // "available on Pro…" on a profile card
  "me_lock", // the same on the "Você" screen
  // Links to the page.
  "home_seo", // home page text
  "workshop", // workshop page
  "gift_notice", // "you got a plan" notification
  "gift_dialog", // gift dialog's link to the full page
  "cancel_page", // back from the cancel page
  "link_other", // ?from= with a name not on this list (blog, email…)
  // The page reached with no door: a fresh load of /pro, by where it came from.
  "direct", // typed, bookmark, app shell — no referrer
  "site_other", // a link on the site that carries no door (a gap to fix)
  "ext_search",
  "ext_youtube",
  "ext_social",
  "ext_other",
  // A pay button with no door on record (storage refused, or over a week old).
  "unknown",
] as const;

export type ProSource = (typeof PRO_SOURCES)[number];

const SOURCE_SET: ReadonlySet<string> = new Set(PRO_SOURCES);

export function isProSource(value: unknown): value is ProSource {
  return typeof value === "string" && SOURCE_SET.has(value);
}

/** Every site event the feature has to list (see experiments.txt). */
export const PRO_SOURCE_CLIENT_EVENTS = PRO_SOURCES.flatMap((source) => [
  `prosrc_open.${source}`,
  `prosrc_checkout.${source}`,
]);

const ENTRY_KEY = "sharescreen:proSource";
/** A load of /pro this soon after a door is that door's page, not a new visit. */
const SAME_VISIT_MS = 30 * 60 * 1000;
const CHECKOUT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function readEntry(): { source: ProSource; at: number } | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ENTRY_KEY) ?? "null") as {
      source?: unknown;
      at?: unknown;
    } | null;
    if (!parsed || !isProSource(parsed.source) || typeof parsed.at !== "number") return null;
    return { source: parsed.source, at: parsed.at };
  } catch {
    return null;
  }
}

/** A door was used: remembered (last touch wins) and counted. */
export function noteProSource(source: ProSource) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ENTRY_KEY, JSON.stringify({ source, at: Date.now() }));
  } catch {
    // Storage refused: the open still counts, the sale goes to "unknown".
  }
  trackFeatureEvent(`prosrc_open.${source}`, { feature: PRO_SOURCE_FEATURE });
}

/** The page's URL for a door; the page reads `from` back (noteProPageVisit). */
export function proHref(source: ProSource, planId?: string | null): string {
  const params = new URLSearchParams();
  if (planId) params.set("plan", planId);
  params.set("from", source);
  return `/pro?${params.toString()}`;
}

/** Whether this document was loaded as /pro, rather than navigated to inside the app. */
function landedOnPro(): boolean {
  try {
    const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (!entry) return false;
    return new URL(entry.name).pathname.replace(/\/+$/, "") === "/pro";
  } catch {
    return false;
  }
}

function referrerSource(): ProSource {
  // A client-side navigation keeps the referrer of the first load, which says
  // nothing about this click: it was an untagged link somewhere on the site.
  if (!landedOnPro()) return "site_other";
  let host = "";
  try {
    host = document.referrer ? new URL(document.referrer).hostname.toLowerCase() : "";
  } catch {
    host = "";
  }
  if (!host) return "direct";
  if (host === window.location.hostname) return "site_other";
  if (/(^|\.)(google|bing|duckduckgo|yahoo|yandex|ecosia|brave)\./.test(host)) return "ext_search";
  if (/(^|\.)(youtube\.com|youtu\.be)$/.test(host)) return "ext_youtube";
  if (
    /(^|\.)(tiktok\.com|instagram\.com|twitter\.com|x\.com|t\.co|facebook\.com|discord\.com|discord\.gg|reddit\.com|whatsapp\.com|threads\.net|kwai\.com)$/.test(
      host
    )
  ) {
    return "ext_social";
  }
  return "ext_other";
}

/**
 * The /pro page opened (not the dialog: that is opened by a door, which noted
 * itself). Reads `?from=`, or works out where a door-less visit came from —
 * unless a door was used moments ago, which is how this page is reached from
 * the dialog, after a login, or back from the payment provider.
 */
export function noteProPageVisit() {
  if (typeof window === "undefined") return;
  const last = readEntry();
  const recent = last !== null && Date.now() - last.at < SAME_VISIT_MS;
  const from = new URLSearchParams(window.location.search).get("from");
  if (from) {
    const source = isProSource(from) ? from : "link_other";
    // A reload of the same link is the same visit.
    if (recent && last.source === source) return;
    noteProSource(source);
    return;
  }
  if (recent) return;
  noteProSource(referrerSource());
}

/** The door on record for a pay click, as `prosrc_checkout.<door>`. */
export function trackProEntryCheckout() {
  if (typeof window === "undefined") return;
  const last = readEntry();
  const source: ProSource = last && Date.now() - last.at <= CHECKOUT_WINDOW_MS ? last.source : "unknown";
  trackFeatureEvent(`prosrc_checkout.${source}`, { feature: PRO_SOURCE_FEATURE });
}

// ---------------------------------------------------------------------------
// Offers with their own experiment, credited in that experiment too

const SOURCES = {
  streamSummary: {
    storageKey: "sharescreen:streamSummaryCtaAt",
    feature: "stream-end-summary",
    checkoutEvent: "stream_summary_checkout",
  },
  turnUpsell: {
    storageKey: "sharescreen:turnUpsellCtaAt",
    feature: "pro-turn-notice",
    checkoutEvent: "turn_upsell_checkout",
  },
};

export function noteProSourceCta(source: keyof typeof SOURCES) {
  try {
    window.localStorage.setItem(SOURCES[source].storageKey, String(Date.now()));
  } catch {
    // Storage refused: that sale just goes unattributed.
  }
}

/**
 * Called by the pay buttons of a plan (not an upgrade's: those call
 * trackProEntryCheckout alone). Every door, and each offer that sent this
 * person.
 */
export function trackProSourceCheckout() {
  trackProEntryCheckout();
  for (const { storageKey, feature, checkoutEvent } of Object.values(SOURCES)) {
    try {
      const at = Number(window.localStorage.getItem(storageKey));
      if (!at || Date.now() - at > CHECKOUT_WINDOW_MS) continue;
    } catch {
      return;
    }
    trackFeatureEvent(checkoutEvent, { feature });
  }
}

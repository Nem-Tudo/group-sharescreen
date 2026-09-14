"use client";

// Every event goes to both analytics the site runs: Umami (self-hosted, the
// one the existing dashboards are built on) and Google Analytics 4 (see the
// gtag snippet in app/layout.tsx). Either can be absent — no env var, a
// blocker, an OBS browser source — and this is a no-op for whichever is.
type AnalyticsWindow = Window & {
  umami?: {
    track: (eventName: string, data?: Record<string, unknown>) => void;
  };
  gtag?: (command: "event", eventName: string, params?: Record<string, string | number>) => void;
};

// GA4 is strict where Umami is not: an event name is at most 40 characters of
// letters, digits and underscores, starting with a letter, and a parameter
// value is a string of at most 100 characters or a number. Anything else is
// dropped by Google without a word — so a name built from a template
// (`${eventPrefix}_error`) or a parameter holding an object would vanish from
// GA while still showing up in Umami, and the two would quietly disagree.
const GA_NAME_MAX = 40;
const GA_PARAM_KEY_MAX = 40;
const GA_PARAM_VALUE_MAX = 100;

function gaEventName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_]/g, "_").replace(/^[^A-Za-z]+/, "");
  return (cleaned || "event").slice(0, GA_NAME_MAX);
}

function gaParams(data?: Record<string, unknown>): Record<string, string | number> | undefined {
  if (!data) return undefined;
  const params: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) continue;
    const gaKey = gaEventName(key).slice(0, GA_PARAM_KEY_MAX);
    if (typeof value === "number") {
      if (Number.isFinite(value)) params[gaKey] = value;
    } else if (typeof value === "string" || typeof value === "boolean") {
      params[gaKey] = String(value).slice(0, GA_PARAM_VALUE_MAX);
    } else {
      params[gaKey] = JSON.stringify(value).slice(0, GA_PARAM_VALUE_MAX);
    }
  }
  return params;
}

export function trackEvent(name: string, data?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  const w = window as AnalyticsWindow;
  w.umami?.track(name, data);
  w.gtag?.("event", gaEventName(name), gaParams(data));
}

// Where a desktop-app download was started from. Four surfaces offer it and
// they answer different questions — the home page is discovery, the room
// banner is someone already using the site, the floating prompt is the nudge,
// and /app is someone who came looking for the app — so the single
// `download_app_clicked` event carries this to tell them apart in Umami and
// GA rather than being one undifferentiated count.
//
// Only "app-page" starts an actual file transfer: the other three now land on
// /app, where the download is one further click. That makes the pair a funnel
// (three sources in, "app-page" out) rather than three equivalent counts, and
// a drop between them is a fact about /app, not about the button upstream.
//
// A union rather than a loose string, and required at every call site, so a
// fifth surface added later cannot quietly land untracked or invent a
// spelling that splits the metric in two.
// "room-gate" is the screen shown before a room is joined (see
// components/RoomAppGate.tsx). Its own value rather than reusing
// "room-banner": the banner asked *inside* a room somebody had already
// entered, so merging them would blur the one thing the change was meant
// to move — whether the offer arrives before or after the join.
export type DownloadSource =
  | "home"
  | "room-banner"
  | "room-gate"
  | "install-prompt"
  | "app-page";

export function trackDownloadClick(source: DownloadSource, platform: string) {
  trackEvent("download_app_clicked", { source, platform });
}


"use client";

type UmamiWindow = Window & {
  umami?: {
    track: (eventName: string, data?: Record<string, unknown>) => void;
  };
};

export function trackEvent(name: string, data?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  (window as UmamiWindow).umami?.track(name, data);
}

// Where a desktop-app download was started from. Four surfaces offer it and
// they answer different questions — the home page is discovery, the room
// banner is someone already using the site, the floating prompt is the nudge,
// and /app is someone who came looking for the app — so the single
// `download_app_clicked` event carries this to tell them apart in Umami
// rather than being one undifferentiated count.
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


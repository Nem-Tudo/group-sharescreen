// Shared between the admin panel (which builds/sends one) and the live
// site-wide banner (which renders whatever the server currently has active)
// so both sides agree on the shape and the color→CSS mapping never drifts
// between the admin's preview and what real visitors actually see.

import { isDesktopApp, isMobileApp } from "./desktop";

export type AnnouncementColor = "green" | "red" | "blue";
export type AnnouncementButtonAction = "open-new-tab" | "open-same-tab" | "reload";
// Mirrors server/signaling.ts's AnnouncementVisibility: "online-only" only
// ever reaches whoever was connected the moment it was sent/edited; "all"
// also reaches every connection opened later, for as long as it stays active.
export type AnnouncementVisibility = "online-only" | "all";
// Mirrors server/signaling.ts's AnnouncementSound.
export type AnnouncementSound = "always" | "live-only" | "off";

// Which kinds of client a banner is meant for. Mirrors
// server/signaling.ts's AnnouncementDevice.
//
// "mobile-app" is the Android shell (see lib/capacitorBridge.ts), reported by
// currentAnnouncementDevice() below. It was defined and selectable for a long
// time before anything reported it, on the reasoning that the day a native
// build shipped the only change needed would be in that function — which is
// how it turned out.
export type AnnouncementDevice =
  | "desktop-browser"
  | "desktop-app"
  | "mobile-browser"
  | "mobile-app";

export const ANNOUNCEMENT_DEVICES: AnnouncementDevice[] = [
  "desktop-browser",
  "desktop-app",
  "mobile-browser",
  "mobile-app",
];

export const ANNOUNCEMENT_DEVICE_LABELS: Record<AnnouncementDevice, string> = {
  "desktop-browser": "Navegador (PC)",
  "desktop-app": "App (PC)",
  "mobile-browser": "Navegador (celular)",
  "mobile-app": "App (celular)",
};

export type Announcement = {
  id: string;
  // Bumped by the server on every edit — see server/signaling.ts's
  // Announcement.version doc comment.
  version: number;
  text: string;
  // When false, no button is rendered at all (see AnnouncementBar.tsx) —
  // buttonLabel/buttonAction/buttonUrl are meaningless placeholders then.
  hasButton: boolean;
  buttonLabel: string;
  buttonAction: AnnouncementButtonAction;
  // Only meaningful for open-new-tab/open-same-tab — null for "reload".
  buttonUrl: string | null;
  color: AnnouncementColor;
  dismissible: boolean;
  visibility: AnnouncementVisibility;
  sound: AnnouncementSound;
  // When true, this banner only ever stops appearing via an explicit "x"
  // click or the admin removing it — it's never auto-hidden after a single
  // view (see the buttonAction === "reload" special case in
  // AnnouncementBanner.tsx) and, for "online-only" visibility specifically,
  // it survives a reload of a browser that already received it live (see
  // getStoredPersistentAnnouncement below) even though the server itself
  // never resends an "online-only" announcement to a new connection.
  persistent: boolean;
  // Which device kinds this banner is for. Optional, and absence means
  // *every* device rather than none: announcements created before this
  // field existed are still sitting in Redis/on disk without it, and the
  // deployed site also has to keep working against an API that predates it.
  // Read through announcementTargetsDevice() below, never directly.
  devices?: AnnouncementDevice[];
};

export const ANNOUNCEMENT_COLOR_PRESETS: Record<
  AnnouncementColor,
  { bg: string; text: string; label: string }
> = {
  green: { bg: "#065f46", text: "#ffffff", label: "Verde" },
  red: { bg: "#7f1d1d", text: "#ffffff", label: "Vermelho" },
  blue: { bg: "#1e3a8a", text: "#ffffff", label: "Azul" },
};

// Announcement ids the person has already dealt with — either they clicked
// the "x" on a dismissible one, or it was a "reload"-action one that already
// got shown once (see hideAnnouncementId's caller in AnnouncementBanner).
// Persisted (not just component state) since the whole point is that it
// survives a reload/reconnect instead of resetting every mount.
const HIDDEN_IDS_STORAGE_KEY = "sharescreen:hiddenAnnouncementIds";
// Caps how many past announcement ids a browser remembers — this is a log
// of everything ever dismissed/shown-once, not the live set, so it would
// otherwise grow forever over a long-lived browser profile.
const MAX_HIDDEN_IDS = 30;

export function getHiddenAnnouncementIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(HIDDEN_IDS_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? (parsed as string[]) : []);
  } catch {
    return new Set();
  }
}

export function hideAnnouncementId(id: string) {
  if (typeof window === "undefined") return;
  try {
    const ids = [...getHiddenAnnouncementIds()];
    if (ids.includes(id)) return;
    ids.push(id);
    const trimmed = ids.length > MAX_HIDDEN_IDS ? ids.slice(ids.length - MAX_HIDDEN_IDS) : ids;
    window.localStorage.setItem(HIDDEN_IDS_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // ignored - localStorage may be unavailable (private mode, quota, etc.)
  }
}

// The last `persistent: true` announcement this browser actually received
// over the socket — the only way a "visibility: online-only" + persistent
// announcement can survive *this same browser* reloading, since the server
// deliberately never resends an online-only announcement to a new
// connection (see server/signaling.ts's "/ws" handler). AnnouncementBanner.tsx
// falls back to this whenever the live signaling state hasn't (yet, or
// ever, for online-only) told it otherwise, and keeps it in sync with every
// real "announcement" message: overwritten on every persistent one, cleared
// on every non-persistent one or explicit clear. A "visibility: all"
// announcement doesn't strictly need this (the server resends it to every
// new connection anyway) but goes through the same cache for one consistent
// code path, and it means one fewer round trip before it (re)appears.
const PERSISTENT_ANNOUNCEMENT_STORAGE_KEY = "sharescreen:persistentAnnouncement";

export function getStoredPersistentAnnouncement(): Announcement | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PERSISTENT_ANNOUNCEMENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Announcement) : null;
  } catch {
    return null;
  }
}

export function storePersistentAnnouncement(announcement: Announcement) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PERSISTENT_ANNOUNCEMENT_STORAGE_KEY, JSON.stringify(announcement));
  } catch {
    // ignored - localStorage may be unavailable (private mode, quota, etc.)
  }
}

export function clearStoredPersistentAnnouncement() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(PERSISTENT_ANNOUNCEMENT_STORAGE_KEY);
  } catch {
    // ignored - localStorage may be unavailable (private mode, quota, etc.)
  }
}

// True for a phone or tablet. UA-first rather than a viewport width, because
// this has to answer "what kind of machine is this" and not "how wide is the
// window" — a half-width browser on a desktop is still a desktop.
export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/android|iphone|ipod|ipad|windows phone/i.test(ua)) return true;
  // iPadOS 13+ deliberately reports a desktop Safari user agent, matching
  // nothing above. The touch-point count is what still separates it from a
  // real Mac — a trackpad reports 0.
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
}

/**
 * Which of the four buckets this client falls into.
 *
 * Both shells expose the same bridge (see lib/desktop.ts) and are told apart
 * by its `platform` — so the mobile branch asks the same question the desktop
 * one does, rather than assuming a phone is always a browser.
 *
 * Note that an installed PWA is deliberately *not* "mobile-app": it is the
 * same website in a chrome-less window, indistinguishable to everything else
 * in this codebase, and calling it an app here would mean "App (celular)"
 * silently targeting people who never installed anything of the sort.
 */
export function currentAnnouncementDevice(): AnnouncementDevice {
  if (isMobileDevice()) return isMobileApp() ? "mobile-app" : "mobile-browser";
  return isDesktopApp() ? "desktop-app" : "desktop-browser";
}

/**
 * Whether `announcement` is meant for this client.
 *
 * Treats a missing or empty list as "everyone" — see the `devices` field's
 * doc comment. Empty specifically matters because it is what an older API
 * hands back, and hiding every banner from every device would be a far worse
 * failure than showing one too widely.
 */
export function announcementTargetsDevice(
  announcement: Pick<Announcement, "devices">,
  device: AnnouncementDevice = currentAnnouncementDevice()
): boolean {
  const devices = announcement.devices;
  if (!Array.isArray(devices) || devices.length === 0) return true;
  return devices.includes(device);
}

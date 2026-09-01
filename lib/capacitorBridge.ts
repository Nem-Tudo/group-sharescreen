"use client";

// The web app's half of the Android shell — the Capacitor equivalent of
// electron/preload.ts + electron/main.ts's deep-link/OAuth handling.
//
// capacitor.config.ts points the Android WebView straight at the deployed
// site (same reasoning as electron/main.ts: a real-time app with server-side
// API routes gets nothing from a bundled static copy), so this module's only
// job is filling in `window.golive` with the exact contract lib/desktop.ts
// already defines. Everything downstream — startOAuthLogin's branch on
// getDesktopBridge(), OpenInAppBanner, UpdateAppButton's optional-chained
// calls — already treats "a golive bridge exists" as the one thing that
// matters, so none of it needed to change for a second shell to plug into it.
//
// What genuinely needs code here, and why:
//
//   - OAuth. Google/Discord refuse to authenticate inside an embedded
//     WebView (Google returns `disallowed_useragent` outright), so the login
//     has to happen in a real browser context and hand its result back
//     through the golive:// scheme — see AndroidManifest.xml's intent-filter.
//     `@capacitor/browser`'s Browser.open() is the Android-recommended way to
//     get that "real browser" context (Chrome Custom Tabs) without leaving
//     the app entirely.
//   - The golive://watch/<handle> and golive://oauth deep links, which need
//     something to receive them — `@capacitor/app`'s appUrlOpen.
//
// What needs nothing here at all: camera and mic. Capacitor's own WebView
// already turns a getUserMedia call into Android's runtime permission
// dialogs (see AndroidManifest.xml's CAMERA/RECORD_AUDIO/MODIFY_AUDIO_SETTINGS
// entries for what that relies on). And screen capture (getDisplayMedia) is
// not implemented by Chromium on Android in *any* embedding — WebView or
// the Chrome app itself — so "compartilhar tela" already falls back to the
// camera there today, on every mobile browser; the Android app inherits that
// exact same fallback rather than needing a native screen-capture path of
// its own (see lib/useRoomMedia.ts's getScreenShareMode).

import { Capacitor } from "@capacitor/core";
import type { DesktopBridge } from "./desktop";
import { desktopOAuthNonce } from "./desktop";

const PROTOCOL = "golive";

// manifest.ts's theme_color/background_color and layout.tsx's
// viewport.themeColor — so the Custom Tab's toolbar reads as part of the app
// rather than a generic browser chrome dropped on top of it.
const BRAND_COLOR = "#09090b";

// Mirrors electron/main.ts's OAUTH_TIMEOUT_MS: generous, because the flow
// involves typing a password and possibly 2FA in another app.
const OAUTH_TIMEOUT_MS = 5 * 60_000;

interface PendingLogin {
  resolve: (fragment: string | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

// Logins currently waiting on the browser, keyed by nonce — same shape and
// same reason as electron/main.ts's `pendingLogins`: any app can register a
// custom scheme, so an unsolicited golive://oauth#... must not be accepted
// unless its nonce names a login this module is actually waiting on.
const pendingLogins = new Map<string, PendingLogin>();

function settleLogin(nonce: string, fragment: string | null) {
  const pending = pendingLogins.get(nonce);
  if (!pending) return;
  pendingLogins.delete(nonce);
  clearTimeout(pending.timer);
  pending.resolve(fragment);
}

// Everything the OS hands the app on the golive:// scheme — the Capacitor
// counterpart of electron/main.ts's handleDeepLink. Both shells speak the
// same protocol on purpose: the site's OAuth callback page and its "abrir no
// app" banner don't know or care which one answers a golive:// link.
function handleDeepLink(rawUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return;
  }
  if (parsed.protocol !== `${PROTOCOL}:`) return;

  // `new URL("golive://oauth#x")` puts "oauth" in `host`, not `pathname` —
  // custom schemes parse as authority-based. Same both-fields check as the
  // desktop side, for the same reason.
  const route = parsed.host || parsed.pathname.replace(/^\/+/, "");

  if (route === "watch") {
    const handle = decodeURIComponent(parsed.pathname.replace(/^\/+/, "")).trim();
    // Validated rather than trusted — mirrors electron/main.ts's HANDLE_RE
    // check, since anything on the device can invoke a golive:// VIEW intent.
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(handle)) return;
    // A full navigation rather than the Next router: this runs outside the
    // React tree (there is no router instance to call), and it is what
    // electron/main.ts's own openRoom does too (loadURL, not an SPA
    // transition) for the exact same deep-link case.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `/watch/${encodeURIComponent(handle)}`;
    return;
  }

  if (route !== "oauth") return;
  const fragment = parsed.hash;
  const next = new URLSearchParams(fragment.replace(/^#/, "")).get("next") ?? "";
  const nonce = desktopOAuthNonce(next);
  if (!nonce) return;
  settleLogin(nonce, fragment);
}

let initStarted = false;

// Fire-and-forget from a top-level effect (see components/CapacitorBridge.tsx).
// A no-op everywhere that isn't this specific shell: every consumer of
// `window.golive` already has to tolerate it being absent (an ordinary
// browser, or a desktop build from before a given bridge method existed), so
// there is nothing else guarding this call site.
export async function initCapacitorBridge(): Promise<void> {
  if (initStarted || typeof window === "undefined") return;
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") return;
  initStarted = true;

  const [{ App }, { Browser }] = await Promise.all([import("@capacitor/app"), import("@capacitor/browser")]);

  App.addListener("appUrlOpen", ({ url }) => handleDeepLink(url));
  // A cold start *from* a golive:// link: the OS launches the app with the
  // URL already attached rather than firing appUrlOpen into a listener that
  // isn't registered yet — the exact counterpart of electron/main.ts reading
  // its own process.argv before creating a window.
  const launch = await App.getLaunchUrl().catch(() => null);
  if (launch?.url) handleDeepLink(launch.url);

  const info = await App.getInfo().catch(() => null);

  const bridge: DesktopBridge = {
    appVersion: info?.version ?? "0.0.0",
    platform: "android",

    startOAuth(startUrl, nonce) {
      // The renderer built this URL, but it is remote content — checked
      // here rather than trusted, same as electron/main.ts's startOAuth:
      // without this an XSS on the site could use the app as a launcher for
      // arbitrary URLs/schemes.
      let parsed: URL;
      try {
        parsed = new URL(startUrl);
      } catch {
        return Promise.resolve(null);
      }
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return Promise.resolve(null);

      return new Promise((resolve) => {
        settleLogin(nonce, null);
        const timer = setTimeout(() => settleLogin(nonce, null), OAUTH_TIMEOUT_MS);
        pendingLogins.set(nonce, { resolve, timer });
        void Browser.open({ url: startUrl, toolbarColor: BRAND_COLOR }).catch(() => settleLogin(nonce, null));
      });
    },

    cancelOAuth(nonce) {
      settleLogin(nonce, null);
    },

    async openExternal(url) {
      await Browser.open({ url, toolbarColor: BRAND_COLOR });
    },
  };

  window.golive = bridge;
}

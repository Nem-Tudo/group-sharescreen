import type { CapacitorConfig } from "@capacitor/cli";

// GoLive Android shell — the Capacitor equivalent of electron/main.ts.
//
// Same shape, same reasoning: this is a shell around the *deployed site*, not
// a second copy of it. The WebView loads https://golive.nemtudo.me (or
// whatever GOLIVE_APP_URL says — the exact env var electron/main.ts reads,
// reused here on purpose so both shells are pointed the same way with one
// override) and the entire UI, all the WebRTC, comes from there unchanged.
//
// Bundling the Next build into the APK instead would buy nothing: this is a
// real-time app that is useless offline anyway, and the site has server-side
// API routes (/api/giphy, /api/umami) a static export cannot serve. One
// deploy, one thing to keep working — see electron/main.ts's own comment,
// which this mirrors.
//
// `webDir` is required by the Capacitor CLI even though nothing in it is ever
// loaded (server.url below always wins over bundled assets). It points at
// public/ rather than an empty folder so `npx cap sync` has something real to
// copy — Android's cold-start splash background and any offline fallback
// asset both come from there.
const APP_URL = process.env.GOLIVE_APP_URL || "https://golive.nemtudo.me";

const config: CapacitorConfig = {
  appId: "me.nemtudo.golive",
  appName: "Go Live",
  webDir: "public",
  server: {
    url: APP_URL,
    // The API domain is never navigated to (fetch/WebSocket calls aren't
    // covered by allowNavigation at all — only top-level page loads are), so
    // it doesn't belong here. Anything not on our own origin — an OAuth
    // provider, a Discord invite, the terms page's outbound links — is left
    // off this list on purpose: Capacitor's default behavior for a
    // navigation to a host that isn't the app's own is to hand it to an
    // external app via an Android VIEW intent instead of loading it in the
    // WebView, which is exactly the will-navigate behavior electron/main.ts
    // implements by hand for the desktop build.
    allowNavigation: [],
    // Only ever true for a plain-HTTP GOLIVE_APP_URL during local
    // development (see electron:dev's GOLIVE_APP_URL=http://localhost:3000).
    cleartext: APP_URL.startsWith("http://"),
  },
};

export default config;

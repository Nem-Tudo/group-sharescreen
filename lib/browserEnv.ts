"use client";

// Two questions about the browser a page is running in, kept in one place so
// the answers cannot drift apart between the screens that ask them.
//
// Neither is a feature test, and neither pretends to be: there is nothing
// here that can be detected by trying it. What both describe is a vendor
// whose behaviour differs from every other one, so both are written as
// narrowly as the decisions they feed.

/**
 * An iPhone, iPod or iPad — including iPadOS 13+, which deliberately reports
 * desktop Safari's user agent and so matches none of the obvious strings.
 * The touch-point count is what still separates it from a real Mac; a
 * trackpad reports 0.
 */
export function isIosDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(ua)) return true;
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
}

/**
 * Running with no browser chrome around it — an installed PWA in its own
 * window, launched from the home screen or the dock.
 *
 * Worth asking before opening anything in a second window: a standalone
 * window has no tab strip to put one in, so the OS hands the URL to the
 * default browser instead and this window is left in the background, where
 * the system is free to discard it.
 */
export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  // iOS Safari never matches the standard media query — it exposes its own
  // `navigator.standalone` instead.
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

let obsDetected = false;

if (typeof window !== "undefined") {
  window.addEventListener("obsStudioInit", () => {
    obsDetected = true;
    try {
      document.documentElement.setAttribute("data-obs", "true");
    } catch {}
  });
}

/**
 * Checks if the current environment is OBS Studio, Streamlabs, or similar
 * broadcasting software (e.g. Browser Source), or accessing via the OBS route.
 */
export function isObsClient(): boolean {
  if (obsDetected) return true;
  if (typeof window === "undefined") return false;

  // 1. Check for OBS Studio & Streamlabs injected APIs
  const win = window as unknown as {
    obsstudio?: unknown;
    streamlabs?: unknown;
  };
  if (Boolean(win.obsstudio) || Boolean(win.streamlabs)) {
    obsDetected = true;
    try {
      document.documentElement.setAttribute("data-obs", "true");
    } catch {}
    return true;
  }

  // 2. Check for broadcast software in User-Agent
  const ua = window.navigator?.userAgent || "";
  if (/OBS|Streamlabs|vMix|XSplit|PrismLive|TwitchStudio|Wirecast/i.test(ua)) {
    obsDetected = true;
    try {
      document.documentElement.setAttribute("data-obs", "true");
    } catch {}
    return true;
  }

  // 3. Check if accessing the dedicated /obs route or test parameters
  if (typeof window.location !== "undefined") {
    if (window.location.pathname?.startsWith("/obs")) {
      obsDetected = true;
      try {
        document.documentElement.setAttribute("data-obs", "true");
      } catch {}
      return true;
    }
    try {
      const searchParams = new URLSearchParams(window.location.search);
      if (
        searchParams.get("preview") === "true" ||
        searchParams.get("isObs") === "true" ||
        searchParams.get("obs") === "true" ||
        searchParams.get("obs") === "1"
      ) {
        obsDetected = true;
        try {
          document.documentElement.setAttribute("data-obs", "true");
        } catch {}
        return true;
      }
    } catch {
      // ignored
    }
  }

  return false;
}

/**
 * Checks if the current environment is an actual broadcasting software like
 * OBS Studio, Streamlabs, vMix, etc. (via window APIs or User-Agent).
 * Returns false for normal web browsers (Chrome, Firefox, Safari, Edge) even on /obs routes.
 */
export function isBroadcastSoftware(): boolean {
  if (typeof window === "undefined") return false;

  const win = window as unknown as {
    obsstudio?: unknown;
    streamlabs?: unknown;
  };
  if (Boolean(win.obsstudio) || Boolean(win.streamlabs)) {
    return true;
  }

  const ua = window.navigator?.userAgent || "";
  if (/OBS|Streamlabs|vMix|XSplit|PrismLive|TwitchStudio|Wirecast/i.test(ua)) {
    return true;
  }

  return false;
}


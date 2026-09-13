"use client";

import { useEffect } from "react";
import { initCapacitorBridge } from "@/lib/capacitorBridge";
import { isMobileApp } from "@/lib/desktop";
import { setSystemBarColors } from "@/lib/nativeApp";

// Mounted once in the root layout, next to PresenceReporter — same pattern,
// same reason: a component with no UI of its own whose only job is to run a
// side effect for the life of the app. See lib/capacitorBridge.ts for what
// that effect actually does; everywhere that isn't the Android shell it
// resolves to nothing within a tick.

/**
 * The colour of the app's top bar and bottom tabs, per theme — what the
 * Android status and navigation bars are painted, so the page runs up to the
 * edges of the screen instead of sitting between two strips of another theme.
 * The same values app/globals.css gives white and zinc-950.
 */
const BAR_COLOR = { light: "#ffffff", dark: "#1a1a1f" } as const;

export function CapacitorBridge() {
  useEffect(() => {
    void initCapacitorBridge();
  }, []);

  useEffect(() => {
    if (!isMobileApp()) return;
    const root = document.documentElement;
    // For the few rules that only make sense inside the app — no tap flash,
    // no rubber-band scrolling (see app/globals.css).
    root.dataset.appShell = "android";
    const paint = () => {
      const dark = root.dataset.theme === "dark";
      setSystemBarColors(dark ? BAR_COLOR.dark : BAR_COLOR.light, dark);
    };
    paint();
    // The theme is an attribute on <html> (see lib/theme.ts), switched from
    // several places; watching the attribute follows all of them.
    const observer = new MutationObserver(paint);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return null;
}

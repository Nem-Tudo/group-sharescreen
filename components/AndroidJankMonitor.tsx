"use client";

import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { useFeature } from "@/lib/features";
import { ANDROID_JANK_FEATURE, reportRendererRecovery, startAndroidJankMonitor } from "@/lib/androidJank";

// Experiment android-jank: measures how much the page freezes inside the
// Android app (see lib/androidJank.ts). No UI. Mounted once in the root
// layout, next to CapacitorBridge; outside the Android app it does nothing
// and does not count anyone as exposed.

function isAndroidApp(): boolean {
  return typeof window !== "undefined" && Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

export function AndroidJankMonitor() {
  // Renders nothing either way, so reading the platform during render cannot
  // make the server and client markup disagree.
  const android = isAndroidApp();
  // Exposure counted only inside the Android app: the measurement runs for as
  // long as the app is open.
  const { enabled, ready } = useFeature(ANDROID_JANK_FEATURE, { track: android });
  const on = android && ready && enabled;

  useEffect(() => {
    if (!on) return;
    void reportRendererRecovery();
    return startAndroidJankMonitor();
  }, [on]);

  return null;
}

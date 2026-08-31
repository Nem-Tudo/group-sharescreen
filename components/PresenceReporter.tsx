"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { signalingClient } from "@/lib/signalingClient";

// Mirrors the tab's current route to the signaling server, so the admin eval
// tool can target by page (see signalingClient.reportPath and the API's
// "presence" message). Renders nothing — it exists only for the effect, and
// sits in the root layout so it sees every navigation the app makes.
export function PresenceReporter() {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname) signalingClient.reportPath(pathname);
  }, [pathname]);
  return null;
}

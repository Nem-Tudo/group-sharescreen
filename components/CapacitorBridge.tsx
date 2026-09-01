"use client";

import { useEffect } from "react";
import { initCapacitorBridge } from "@/lib/capacitorBridge";

// Mounted once in the root layout, next to PresenceReporter — same pattern,
// same reason: a component with no UI of its own whose only job is to run a
// side effect for the life of the app. See lib/capacitorBridge.ts for what
// that effect actually does; everywhere that isn't the Android shell it
// resolves to nothing within a tick.
export function CapacitorBridge() {
  useEffect(() => {
    void initCapacitorBridge();
  }, []);
  return null;
}

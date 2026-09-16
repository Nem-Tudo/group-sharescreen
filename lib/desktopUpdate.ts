"use client";

import { getSignalingHttpBase } from "./roomsApi";

// Telling the server that somebody pressed "instalar" on a desktop update, so
// the admin panel can say how many took the rollout it just launched (see the
// API's desktopUpdateClickStore.ts).
//
// keepalive, and that is the whole point of this file: the press quits the app
// a moment later, and an ordinary fetch would be cancelled with the page that
// started it. Nothing is read back and nothing is awaited by the caller — a
// counter must never stand between somebody and the update they asked for.
export async function reportDesktopUpdateClick(version: string | null): Promise<void> {
  try {
    await fetch(`${getSignalingHttpBase()}/desktop-update/click`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version }),
      keepalive: true,
    });
  } catch {
    // Offline, or the app went down first. The install is what matters.
  }
}

"use client";

import { useEffect } from "react";
import { getDesktopBridge } from "@/lib/desktop";
import { useNotificationInbox } from "@/lib/notificationInbox";

// Tells the desktop shell when the bell's newest unread notification arrived,
// so it can flash the taskbar entry for anything that came in while the window
// was not in front (see electron/main.ts's refreshTaskbarFlash).
//
// A timestamp rather than "is anything unread": the shell stops flashing once
// the window is brought up, bell opened or not, and needs to tell a notification
// it already did that for from a newer one. A DM thread already in the bell
// gets a fresh `ts` on every message (see upsertNotification), so each message
// counts as new here.
//
// Mounted once at the layout root rather than inside the bell: the bell is only
// on some pages, and the flash has to follow the inbox from all of them.
// Renders nothing, and does nothing outside the desktop app.

export function DesktopUnreadFlash() {
  const items = useNotificationInbox();
  const newestUnreadAt = items.reduce(
    (newest, item) => (item.read ? newest : Math.max(newest, item.ts)),
    0
  );

  useEffect(() => {
    getDesktopBridge()?.setNewestUnreadNotification?.(newestUnreadAt);
  }, [newestUnreadAt]);

  return null;
}

"use client";

import { useEffect } from "react";
import { getDesktopBridge } from "@/lib/desktop";
import { useNotificationInbox } from "@/lib/notificationInbox";

// Tells the desktop shell whether the bell has anything unread, so it keeps
// the taskbar entry flashing until somebody opens the bell (see
// electron/main.ts's refreshTaskbarFlash).
//
// Mounted once at the layout root rather than inside the bell: the bell is only
// on some pages, and the flash has to follow the inbox from all of them.
// Renders nothing, and does nothing outside the desktop app.

export function DesktopUnreadFlash() {
  const items = useNotificationInbox();
  const hasUnread = items.some((item) => !item.read);

  useEffect(() => {
    getDesktopBridge()?.setUnreadNotifications?.(hasUnread);
  }, [hasUnread]);

  return null;
}

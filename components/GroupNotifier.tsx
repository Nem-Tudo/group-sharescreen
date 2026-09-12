"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { useGroupNavigation } from "@/lib/groupNavigation";
import { showNotification } from "@/lib/notifications";
import { playDirectMessageSound } from "@/lib/soundEffects";
import { useSignaling } from "@/lib/useSignaling";

// Turns a group message this account asked to hear about — its notification
// level for the group, or a mention — into a chime and a notification.
//
// New, because until now a group message only ever reached anybody as a
// push, to the devices that had nothing open: an open app or tab said nothing
// about a mention at all. The push now holds back whenever anything of the
// account is open (see the API's pushSender), so the open thing announces it
// instead — here, on the one connection the server picked to make the noise.
//
// Mounted once at the root, like DmNotifier, for the same reason.

export function GroupNotifier() {
  const { account } = useAuth();
  const { lastGroupNotify, groupNotifySeq, alertTarget } = useSignaling();
  const pathname = usePathname();
  const navigation = useGroupNavigation();
  // The last message announced — see DmNotifier's announcedRef for the bug
  // this guards against: an effect re-run by an unrelated dependency must not
  // announce the same message again.
  const announcedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!account || !lastGroupNotify) return;
    if (announcedRef.current === lastGroupNotify.messageId) return;
    announcedRef.current = lastGroupNotify.messageId;
    if (!alertTarget) return;
    // Reading that very room right now: the message is already on screen.
    if (pathname === lastGroupNotify.url && document.visibilityState === "visible") return;

    playDirectMessageSound();
    void showNotification({
      title: lastGroupNotify.title,
      body: lastGroupNotify.body,
      // One per room, carrying the newest — the same collapse the push uses.
      tag: `group:${lastGroupNotify.channelId}`,
      icon: lastGroupNotify.icon ?? undefined,
      // A client-side navigation, so a call running in this tab is not
      // dropped by a reload (see lib/groupNavigation).
      onClick: () => navigation.push(lastGroupNotify.url),
    });
    // pathname, navigation and alertTarget are read at the moment a message
    // lands, not reacted to: none of them changing is a new message.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupNotifySeq, lastGroupNotify, account]);

  return null;
}

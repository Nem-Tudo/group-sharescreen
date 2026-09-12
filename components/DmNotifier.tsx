"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@/lib/AuthContext";
import { showNotification } from "@/lib/notifications";
import { isPageInFront } from "@/lib/pageFocus";
import { upsertNotification } from "@/lib/notificationInbox";
import { playDirectMessageSound } from "@/lib/soundEffects";
import { openDirectMessages, useDirectMessagesWindow } from "@/lib/dmWindow";
import { useSignalingSelector, shallow } from "@/lib/useSignalingSelector";
import { selectDmNudge } from "@/lib/signalingSelectors";
import { translate } from "@/lib/i18n";

// Turns an arriving private message into a chime, a bell entry and — if the
// tab is not in front — a system notification.
//
// Three things it deliberately does not do:
//
//   - announce your own message. It arrives on this socket too, because the
//     sender's other devices need it, and a chime for something you just
//     typed is the most annoying possible notification.
//   - announce a thread that is open on screen, with the page in front.
//     Somebody reading the conversation is already looking at the message.
//     Open but behind another window, or in a tab in the background, is not
//     being read — that one is announced like any other.
//   - dedupe by content. The inbox key is the *sender*, so a burst of five
//     messages is one row in the bell rather than five, and the row's body is
//     the newest of them.

export function DmNotifier() {
  const { account } = useAuth();
  // Only the connection the server picked makes the noise — the app if it is
  // open, otherwise the tab used last (see SignalingState.alertTarget). The
  // bell fills up everywhere; the chime and the notification happen once.
  const { lastDm, dmSeq, alertTarget } = useSignalingSelector(selectDmNudge, shallow);
  const { open, withUserId } = useDirectMessagesWindow();

  // The last message this component actually announced.
  //
  // Without it, the effect below re-ran on every change to *any* of its
  // dependencies — closing the window is one — and re-announced whatever
  // `lastDm` still held: a fresh chime and a fresh unread badge for a message
  // already read. It only stopped when a reply pushed a new `lastDm` in,
  // which is exactly the shape of the bug that was reported.
  const announcedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!lastDm || !account) return;
    const { message, fromUser } = lastDm;
    if (message.from === account.id) return;
    if (announcedRef.current === message.id) return;
    // The thread is on screen and the page is in front: the message is
    // already being read. Marked as announced anyway, so it cannot come back
    // the moment the window closes.
    if (open && withUserId === message.from && isPageInFront()) {
      announcedRef.current = message.id;
      return;
    }
    announcedRef.current = message.id;

    const name = fromUser?.displayName ?? translate("common.someone");
    // Keyed by sender rather than by message, so a burst collapses into one
    // row. Replaced rather than added when it already exists, so the row
    // carries the newest line instead of the first one.
    upsertNotification({
      id: `dm:${message.from}`,
      kind: "dm",
      title: translate("dmNotifier.messageFromName", { name }),
      body: message.text,
      userId: message.from,
    });
    if (!alertTarget) return;
    playDirectMessageSound();
    void showNotification({
      title: name,
      body: message.text,
      tag: `dm:${message.from}`,
      onClick: () => openDirectMessages(message.from),
    });
  }, [dmSeq, lastDm, account, open, withUserId, alertTarget]);

  return null;
}

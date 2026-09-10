"use client";

import { useEffect } from "react";
import { pushNotification } from "@/lib/notificationInbox";
import { showNotification } from "@/lib/notifications";
import { playFriendRequestSound } from "@/lib/soundEffects";
import { useAuth } from "@/lib/AuthContext";
import { useSignaling } from "@/lib/useSignaling";

// Tells somebody a plan was bought for them.
//
// Mounted once at the layout root, beside SocialNotifier, and for the same
// reason: this arrives whenever it arrives, and a bell that only filled up
// while you happened to be on the right page would be empty exactly when you
// look at it.
//
// Unlike that one this is an *event* rather than a sweep, because the fact it
// reports is not a row anybody can re-read: the days are already on the
// account and look no different from days that were paid for. A missed message
// costs the announcement and nothing else — the plan itself is there either
// way, which is why nothing below treats this message as evidence of what was
// granted.

export function GiftNotifier() {
  const { account, refresh } = useAuth();
  const { lastGift } = useSignaling();

  useEffect(() => {
    if (!account || !lastGift) return;

    // First, because it is the part that matters: the entitlement changed
    // under this tab without this tab doing anything, and until the account is
    // re-read every Pro-only control on screen is still locked. Done whether
    // or not the notification is new — a duplicate message is cheap to act on
    // and a stale set of features is not.
    refresh();

    // Named after the present rather than the moment, so the same message
    // arriving twice (two tabs, a reconnect) is one line in the bell.
    const isNew = pushNotification({
      id: `gift:${lastGift.giftId}`,
      kind: "gift",
      title: "Você ganhou um plano!",
      body:
        lastGift.days > 0
          ? `${lastGift.planTitle} por ${lastGift.days} dias, de presente.`
          : `${lastGift.planTitle}, de presente.`,
      href: "/pro",
    });
    if (!isNew) return;

    playFriendRequestSound();
    // For the case the sound is not enough because the tab is behind
    // something else. showNotification stays quiet when the page is focused,
    // so this never doubles up with the bell somebody is looking straight at.
    void showNotification({
      title: "Você ganhou um plano!",
      body: `${lastGift.planTitle} está liberado na sua conta.`,
      tag: `gift:${lastGift.giftId}`,
    });
  }, [account, lastGift, refresh]);

  return null;
}

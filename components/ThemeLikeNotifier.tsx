"use client";

import { useEffect } from "react";
import { pushNotification } from "@/lib/notificationInbox";
import { showNotification } from "@/lib/notifications";
import { playFriendRequestSound } from "@/lib/soundEffects";
import { useAuth } from "@/lib/AuthContext";
import { useSignaling } from "@/lib/useSignaling";

// Tells an author somebody liked one of their themes.
//
// Mounted once at the layout root, beside GiftNotifier, for the same reason:
// a like arrives whenever it arrives, and a bell that only filled up on the
// workshop page would be empty exactly when somebody looks at it.
//
// An event rather than a sweep, like the gift one. Who liked what is on the
// theme, but nothing on the site lists it back to its author as news, so the
// socket message is the only moment there is to announce it. The server
// already refuses to send one for your own theme or for a heart pressed again
// (see the API's announceThemeLike).

export function ThemeLikeNotifier() {
  const { account } = useAuth();
  // See DmNotifier: the bell everywhere, the noise on one connection only.
  const { lastThemeLike, alertTarget } = useSignaling();

  useEffect(() => {
    if (!account || !lastThemeLike) return;

    const title = `${lastThemeLike.byName} curtiu seu tema`;
    // Named after the person and the theme rather than the moment, so the same
    // like arriving twice — two tabs, a reconnect, an unlike and a like again —
    // is one line in the bell.
    const tag = `theme-like:${lastThemeLike.themeId}:${lastThemeLike.byId ?? "?"}`;
    const isNew = pushNotification({
      id: tag,
      kind: "theme-like",
      title,
      body: lastThemeLike.themeName,
      href: `/tema/${encodeURIComponent(lastThemeLike.themeId)}`,
      userId: lastThemeLike.byId ?? undefined,
    });
    if (!isNew || !alertTarget) return;

    playFriendRequestSound();
    // showNotification stays quiet when the page is focused, so this never
    // doubles up with the bell somebody is looking straight at.
    void showNotification({ title, body: lastThemeLike.themeName, tag });
    // alertTarget is read, not reacted to — see SocialNotifier.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, lastThemeLike]);

  return null;
}

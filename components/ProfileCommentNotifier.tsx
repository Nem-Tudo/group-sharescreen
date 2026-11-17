"use client";

import { useEffect } from "react";
import { pushNotification } from "@/lib/notificationInbox";
import { showNotification } from "@/lib/notifications";
import { playFriendRequestSound } from "@/lib/soundEffects";
import { useAuth } from "@/lib/AuthContext";
import { useSignalingSelector, shallow } from "@/lib/useSignalingSelector";
import { translate } from "@/lib/i18n";
import { selectProfileCommentNudge } from "@/lib/signalingSelectors";

// Tells somebody a comment landed on their profile (experiment
// profile-comments). Mounted at the layout root beside ThemeLikeNotifier, and
// built the same way: the socket message is the only moment there is to
// announce it, the bell everywhere, the noise only on the connection elected
// to make it. The API sends none for a comment on your own profile.

export function ProfileCommentNotifier() {
  const { account } = useAuth();
  const { lastProfileComment, alertTarget } = useSignalingSelector(selectProfileCommentNudge, shallow);

  useEffect(() => {
    if (!account || !lastProfileComment) return;
    const title = translate("profileComments.notifyTitle", { name: lastProfileComment.byName });
    const body = lastProfileComment.text || (lastProfileComment.gif ? translate("profileComments.notifyGif") : "");
    // Named after the comment, so the same one arriving on two tabs or after
    // a reconnect is one line in the bell.
    const tag = `profile-comment:${lastProfileComment.commentId}`;
    const isNew = pushNotification({
      id: tag,
      kind: "profile-comment",
      title,
      body,
      href: `/user/${encodeURIComponent(account.username)}#comments`,
      userId: lastProfileComment.byId ?? undefined,
    });
    if (!isNew || !alertTarget) return;
    playFriendRequestSound();
    void showNotification({ title, body, tag });
    // alertTarget is read, not reacted to — see SocialNotifier.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, lastProfileComment]);

  return null;
}

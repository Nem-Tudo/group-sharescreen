"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { showNotification } from "@/lib/notifications";
import { dismissNotification, pushNotification } from "@/lib/notificationInbox";
import { openDirectMessages } from "@/lib/dmWindow";
import { playFriendRequestSound } from "@/lib/soundEffects";
import { useAuth } from "@/lib/AuthContext";
import { useSocialGraph } from "@/lib/useSocialGraph";
import { useSignalingSelector } from "@/lib/useSignalingSelector";
import { selectAlertTarget } from "@/lib/signalingSelectors";
import { translate } from "@/lib/i18n";

// Turns changes in the social graph into things in the bell.
//
// Mounted once at the layout root so it runs on every page: a friend request
// arrives whenever it arrives, and a bell that only filled up while you
// happened to be inside a room would be a bell that is empty exactly when you
// open it.
//
// It is a *sweep*, not a diff. Every pass pushes one notification per pending
// request; the inbox dedups by id (see notificationInbox.ts) and reports
// whether anything was actually new, and only that answer triggers the sound.
// A diff would have to remember what it saw last, across reloads and across
// tabs — which is the same "seen" bookkeeping the inbox already does, done
// twice and able to disagree with itself.
//
// The one exception is an acceptance. "Somebody is a friend" is not news, and
// the graph holds no trace of who asked first once a request is answered — so
// the only way to tell "they just accepted" from "they have been a friend for
// a year" is having seen them among the outgoing requests before. That set is
// the one thing remembered here (see SENT_KEY), per account and in
// localStorage, so an acceptance that happened while the app was closed still
// lands on the next visit.

const SENT_KEY = "sharescreen:sent-friend-requests";

function readSentRequests(accountId: string): Set<string> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(`${SENT_KEY}:${accountId}`) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function writeSentRequests(accountId: string, ids: string[]) {
  try {
    const key = `${SENT_KEY}:${accountId}`;
    if (ids.length === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    // ignored - localStorage may be unavailable (private mode, quota, etc.)
  }
}

export function SocialNotifier() {
  const { account } = useAuth();
  const { graph, loading } = useSocialGraph();
  // See DmNotifier: the bell everywhere, the noise on one connection only.
  const alertTarget = useSignalingSelector(selectAlertTarget);
  const router = useRouter();
  const accountId = account?.id ?? null;

  useEffect(() => {
    let arrived = 0;
    let last: { name: string; id: string } | null = null;

    for (const user of graph.incoming) {
      const isNew = pushNotification({
        id: `friend-request:${user.id}`,
        kind: "friend-request",
        title: translate("socialNotifier.newFriendRequest"),
        body: `${user.displayName} quer ser seu amigo.`,
        href: "/friends",
      });
      if (!isNew) continue;
      arrived += 1;
      last = { name: user.displayName, id: user.id };
    }

    // A request that is no longer pending — accepted here, or withdrawn by
    // them — takes its notification with it. A bell that still offers to
    // answer something already answered is worse than an empty one.
    const pending = new Set(graph.incoming.map((user) => `friend-request:${user.id}`));
    for (const user of graph.friends) {
      if (!pending.has(`friend-request:${user.id}`)) {
        dismissNotification(`friend-request:${user.id}`);
      }
    }

    let accepted = 0;
    let lastAccepted: { name: string; id: string } | null = null;

    // Only against a graph that really is this account's: the empty stand-in
    // shown while loading would read as "every request withdrawn" and wipe the
    // remembered set before the real one arrived.
    if (accountId && !loading) {
      const sent = readSentRequests(accountId);
      for (const user of graph.friends) {
        if (!sent.has(user.id)) continue;
        const isNew = pushNotification({
          id: `friend-accepted:${user.id}`,
          kind: "friend-accepted",
          title: translate("socialNotifier.friendRequestAccepted"),
          body: translate("socialNotifier.nameAcceptedYourRequest", { name: user.displayName }),
          href: "/friends",
          userId: user.id,
        });
        if (!isNew) continue;
        accepted += 1;
        lastAccepted = { name: user.displayName, id: user.id };
      }
      // Asking again means the earlier friendship was undone since. Its old
      // "aceitou" would otherwise sit in the bell under the same id and make
      // the next acceptance look like nothing new.
      for (const user of graph.outgoing) dismissNotification(`friend-accepted:${user.id}`);
      writeSentRequests(accountId, graph.outgoing.map((user) => user.id));
    }

    if ((arrived === 0 && accepted === 0) || !alertTarget) return;
    playFriendRequestSound();
    // The system notification is for the case the sound is not enough: the tab
    // is behind something else. showNotification already stays quiet when the
    // page is focused and visible, so this does not double up with the bell
    // the person is looking straight at.
    if (arrived > 0) {
      void showNotification({
        title: arrived === 1 ? translate("socialNotifier.newFriendRequest") : `${arrived} pedidos de amizade`,
        body:
          arrived === 1 && last
            ? `${last.name} quer ser seu amigo.`
            : translate("socialNotifier.openGoliveToReply"),
        tag: "friend-requests",
        onClick: () => router.push("/friends"),
      });
    }
    if (accepted > 0) {
      const only = accepted === 1 ? lastAccepted : null;
      void showNotification({
        title: translate("socialNotifier.friendRequestAccepted"),
        body: only
          ? translate("socialNotifier.nameAcceptedYourRequest", { name: only.name })
          : translate("socialNotifier.countAcceptedYourRequests", { count: accepted }),
        tag: "friend-accepted",
        // Straight into a conversation with the new friend: that is the next
        // thing to do with one, and the DM window opens over whatever page this
        // is instead of navigating away from a call.
        onClick: () => (only ? openDirectMessages(only.id) : router.push("/friends")),
      });
    }
    // alertTarget is read, not reacted to: a sweep re-run because the answer
    // moved finds nothing new in the bell, so it cannot chime twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, loading, accountId]);

  return null;
}

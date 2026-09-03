"use client";

import { useEffect } from "react";
import { showNotification } from "@/lib/notifications";
import { dismissNotification, pushNotification } from "@/lib/notificationInbox";
import { playFriendRequestSound } from "@/lib/soundEffects";
import { useSocialGraph } from "@/lib/useSocialGraph";

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

export function SocialNotifier() {
  const { graph } = useSocialGraph();

  useEffect(() => {
    let arrived = 0;
    let last: { name: string; id: string } | null = null;

    for (const user of graph.incoming) {
      const isNew = pushNotification({
        id: `friend-request:${user.id}`,
        kind: "friend-request",
        title: "Novo pedido de amizade",
        body: `${user.displayName} quer ser seu amigo.`,
        href: "/amigos",
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

    if (arrived === 0) return;
    playFriendRequestSound();
    // The system notification is for the case the sound is not enough: the tab
    // is behind something else. showNotification already stays quiet when the
    // page is focused and visible, so this does not double up with the bell
    // the person is looking straight at.
    void showNotification({
      title: arrived === 1 ? "Novo pedido de amizade" : `${arrived} pedidos de amizade`,
      body:
        arrived === 1 && last
          ? `${last.name} quer ser seu amigo.`
          : "Abra o GoLive para responder.",
      tag: "friend-requests",
    });
  }, [graph]);

  return null;
}

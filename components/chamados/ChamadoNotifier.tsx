"use client";

import { useEffect } from "react";
import { pushNotification } from "@/lib/notificationInbox";
import { showNotification } from "@/lib/notifications";
import { playFriendRequestSound } from "@/lib/soundEffects";
import { useAuth } from "@/lib/AuthContext";
import { useSignalingSelector, shallow } from "@/lib/useSignalingSelector";
import { translate } from "@/lib/i18n";
import { selectChamadoGoingNudge } from "@/lib/signalingSelectors";
import { chamadoPath, refreshChamados } from "@/lib/chamados";

// Tells the author of a chamado that somebody said "Tô dentro" (experiment
// chamados). Mounted at the layout root beside ProfileCommentNotifier and
// built the same way: the socket message is the only moment there is to
// announce it, the bell everywhere, the sound only on the connection elected
// to make it.

export function ChamadoNotifier() {
  const { account } = useAuth();
  const { lastChamadoGoing, alertTarget } = useSignalingSelector(selectChamadoGoingNudge, shallow);

  useEffect(() => {
    if (!account || !lastChamadoGoing) return;
    const title = translate("chamados.notifyTitle", { name: lastChamadoGoing.byName });
    const body = lastChamadoGoing.what;
    // One row per person and chamado: saying it, undoing and saying it again is one line.
    const tag = `chamado-going:${lastChamadoGoing.chamadoId}:${lastChamadoGoing.byId ?? lastChamadoGoing.seq}`;
    const isNew = pushNotification({
      id: tag,
      kind: "chamado-going",
      title,
      body,
      href: chamadoPath(lastChamadoGoing.chamadoId),
      userId: lastChamadoGoing.byId ?? undefined,
    });
    // The card's "N tô dentro" is on the feed this author may be looking at.
    void refreshChamados();
    if (!isNew || !alertTarget) return;
    playFriendRequestSound();
    void showNotification({ title, body, tag });
    // alertTarget is read, not reacted to — see SocialNotifier.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, lastChamadoGoing]);

  return null;
}

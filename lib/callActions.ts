"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  acceptCall,
  callPeerFor,
  endCall as endRingingCall,
  markOwnCall,
  rememberCallPeer,
  type CallPeer,
} from "./callsApi";
import { getCallSession, setCallSession } from "./callSession";
import { dmPath } from "./groupLinks";
import { useGroupNavigation } from "./groupNavigation";
import { isCallRoomHandle } from "./roomsApi";
import { signalingClient, type CallWire } from "./signalingClient";
import { stopRingtone } from "./soundEffects";

// Everything a ring can be answered *with*, in one place.
//
// It used to live inside components/CallHost, which was fine while that was
// the only screen a call could be answered from. It is not any more: a
// conversation now shows the ring on the thread of the person doing the
// ringing, and shows a call already under way so it can be walked back into
// (see components/DirectMessagesModal). Two copies of "mark the call as this
// tab's, accept it, remember who it is with, open the session, go to the
// conversation" is two copies of a sequence whose every step matters — the
// ordering below is load-bearing, and a second implementation that drifted
// from it would fail in ways nobody would connect to this file.
//
// It holds no state of its own. What a call *is* belongs to the server while
// it rings (see lib/callsApi) and to lib/callSession once it is answered.

/** The other person on a call, as the ring carries them. */
function peerOf(user: CallWire["from"]): CallPeer {
  return { userId: user.id, displayName: user.displayName, avatarUrl: user.avatarUrl };
}

export function useCallActions() {
  const router = useRouter();
  // Shallow while the group pages are on screen — a direct call lands in the
  // private messages, which are one of them (see lib/groupNavigation).
  const navigation = useGroupNavigation();

  /**
   * Walks into the room a call turned into.
   *
   * A direct call is not a place of its own: it belongs to the conversation
   * the two of them have, and is drawn there, on that person's thread, the way
   * a group's call is drawn in the group (see lib/callSession's `dm`). So the
   * session is opened here and the address that follows is the conversation's.
   *
   * Anything else — an invitation into a room that already existed ("chamar
   * para esta sala"), or a call this tab never saw ring and so cannot name the
   * other end of — is the room page it always was.
   */
  const enterRoom = useCallback(
    (roomHandle: string, peer?: CallPeer | null) => {
      // Only a room minted *for* a call belongs to a conversation. A ring that
      // ends in a room somebody already had ("chamar para esta sala") is an
      // invitation into that room, and stays the room page it always was —
      // which is why the handle decides this and not whether a person is known.
      const known = isCallRoomHandle(roomHandle) ? peer ?? callPeerFor(roomHandle) : null;
      if (!known) {
        router.push(`/watch/${roomHandle}`);
        return;
      }
      // Remembered here as well as by whoever placed or answered the call: a
      // room walked back into from the conversation may never have rung on
      // this tab at all, and the session cannot be opened without a person.
      rememberCallPeer(roomHandle, known);
      setCallSession({ handle: roomHandle, viewThemeId: null, group: null, dm: known });
      navigation.push(dmPath(known.userId));
    },
    [navigation, router]
  );

  /**
   * Answers a ring.
   *
   * Returns the error to show rather than showing one: the ringing screen and
   * the conversation say it in different places. Either way the call is taken
   * off this tab's screen — whatever went wrong, it is not ringing any more,
   * and leaving the buttons up offers to answer something that is gone.
   */
  const answer = useCallback(
    async (call: CallWire): Promise<{ ok: true } | { ok: false; error: string }> => {
      stopRingtone();
      // Before the request, not after: the "call-accepted" it causes can reach
      // this tab ahead of the response, and has to find it already marked as
      // the one that walks in.
      markOwnCall(call.id);
      // And who it is with, for the same reason: the server sends that
      // "call-accepted" before it answers this request, and CallHost walks in
      // on it with only the room's handle. Not knowing the person there sent
      // the call to its bare /watch page instead of the conversation — whose
      // session then overwrote this one, leaving an "entrar na chamada" button
      // where the call should have been.
      if (isCallRoomHandle(call.roomHandle)) rememberCallPeer(call.roomHandle, peerOf(call.from));
      const result = await acceptCall(call.id);
      signalingClient.clearCall(call.id);
      if (!result.ok) return result;
      // Navigated here as well as from the socket message (see CallHost): on a
      // cold start the socket may not even be connected yet, and whoever
      // pressed "atender" must not be left looking at a button that did
      // nothing.
      enterRoom(result.roomHandle, peerOf(call.from));
      return { ok: true };
    },
    [enterRoom]
  );

  /**
   * Refuses a ring, or gives up on one.
   *
   * Taken off screen at once and reported afterwards: the refusal is what
   * matters, and a request that failed is corrected by the call timing out —
   * exactly what would have happened had nobody pressed anything.
   */
  const stopRinging = useCallback(
    (callId: string, side: "decline" | "cancel", reason?: string) => {
      stopRingtone();
      signalingClient.clearCall(callId);
      return endRingingCall(callId, side, reason);
    },
    []
  );

  /**
   * Walks into a direct call that is already under way — one this account was
   * in and left while the other person stayed, or one answered on another
   * device. There is no ring to accept: the room is an ordinary private room
   * whose handle is its own key (see the API's makeCallRoomHandle), so joining
   * it is opening the session on it.
   */
  const joinOngoing = useCallback(
    (roomHandle: string, peer: CallPeer) => {
      if (getCallSession()?.handle === roomHandle) {
        navigation.push(dmPath(peer.userId));
        return;
      }
      enterRoom(roomHandle, peer);
    },
    [enterRoom, navigation]
  );

  return { enterRoom, answer, stopRinging, joinOngoing };
}

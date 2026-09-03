"use client";

import { useEffect, useRef } from "react";
import {
  PEER_RESETTLE_MS,
  signalingClient,
  type PeerInfo,
  type SignalingState,
} from "./signalingClient";
import {
  playJoinSound,
  playLeaveSound,
  playMentionSound,
  playShareStartSound,
  playShareStopSound,
} from "./soundEffects";
import { containsBroadcastMention } from "./chatMentions";

// Plays a sound whenever another peer joins/leaves the room, starts/stops
// sharing, or mentions this user in chat. Deliberately scoped to *other*
// peers/messages only — the local user already gets immediate feedback from
// clicking their own buttons, so echoing that back as a sound would be
// redundant (and, for sharing, would double up with the mic/share toggle
// sounds a browser or OS might already play).
// Moderator "ghost" peers (see server/signaling.ts's admin-join) ride the
// same peer list as everyone else so their WebRTC connections get set up
// transparently — but a participant must never get *any* signal that one
// came or went, and a join/leave chime is exactly that. Dropped from both
// the baseline and the diff below, so neither a moderator arriving nor one
// leaving can ever be heard.
function realPeerMap(peers: PeerInfo[]): Map<string, PeerInfo> {
  return new Map(peers.filter((p) => p.role !== "moderator").map((p) => [p.id, p]));
}

export function useRoomSoundEffects(state: SignalingState) {
  const prevPeersRef = useRef<Map<string, PeerInfo>>(new Map());
  const chatBaselineRef = useRef(0);
  // False until the first "room-state" this hook has seen — guards against
  // treating a room's entire existing peer list / chat history as a burst
  // of brand new joins and mentions the moment this hook mounts.
  const readyRef = useRef(false);
  // Until when arrivals and departures are treated as resettling rather than
  // as news. A room-state is the one moment the peer list can move for
  // reasons that are not people: after a server restart everybody reconnects
  // over the next few seconds, and each one arriving is a "peer-joined" that
  // is not somebody entering the room — they never left it, their screen
  // share was playing the whole time. signalingClient carries them across the
  // gap (see PEER_RESETTLE_MS) and prunes whoever really did go, and this is
  // the matching silence over both halves of that.
  //
  // A margin past the prune on purpose: the prune is a removal, and a removal
  // is a leave chime. Ending the silence first would turn "we worked out who
  // actually left" into a burst of departures, which is precisely the noise
  // this exists to remove.
  const settledAtRef = useRef(0);

  useEffect(() => {
    // Fires on every "room-state" — the initial join, a room switch, and a
    // reconnect rejoining the same room — so each of those re-baselines
    // instead of being misread as every peer joining/leaving at once.
    const unsubscribe = signalingClient.onRoomJoined(() => {
      prevPeersRef.current = realPeerMap(signalingClient.state.peers);
      chatBaselineRef.current = signalingClient.state.chatMessages.length;
      settledAtRef.current = Date.now() + PEER_RESETTLE_MS + 1500;
      readyRef.current = true;
    });
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!readyRef.current || !state.room) return;
    const prevPeers = prevPeersRef.current;
    const nextPeers = realPeerMap(state.peers);

    // Only comings and goings are silenced while the list resettles.
    // Somebody starting or stopping a share in that window is a real action
    // they just took, and hearing it is the point.
    const resettling = Date.now() < settledAtRef.current;

    for (const [id, peer] of nextPeers) {
      const prev = prevPeers.get(id);
      if (!prev) {
        if (!resettling) playJoinSound();
        continue;
      }
      if (!prev.sharing && peer.sharing) playShareStartSound();
      else if (prev.sharing && !peer.sharing) playShareStopSound();
    }
    for (const id of prevPeers.keys()) {
      if (!nextPeers.has(id) && !resettling) playLeaveSound();
    }

    prevPeersRef.current = nextPeers;
  }, [state.peers, state.room]);

  useEffect(() => {
    if (!readyRef.current) return;
    const messages = state.chatMessages;
    const newMessages = messages.slice(chatBaselineRef.current);
    chatBaselineRef.current = messages.length;
    if (!state.name || newMessages.length === 0) return;

    const mentionToken = `@${state.name}`.toLowerCase();
    const selfLower = state.name.toLowerCase();
    const mentioned = newMessages.some(
      (m) =>
        m.from !== state.selfId &&
        ((m.kind !== "gif" &&
          (m.text.toLowerCase().includes(mentionToken) || containsBroadcastMention(m.text))) ||
          (Boolean(m.replyTo) && m.replyTo?.name.trim().toLowerCase() === selfLower))
    );
    if (mentioned) playMentionSound();
  }, [state.chatMessages, state.name, state.selfId]);
}

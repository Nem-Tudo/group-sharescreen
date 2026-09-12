"use client";

// The slices components subscribe to, kept here at module scope rather than
// written inline at each call site.
//
// That placement is the whole point: useSignalingSelector caches on the
// identity of the selector it is given, so an arrow function written in a
// render body would rebuild the cache and re-subscribe on every render, and
// the hook would cost more than the whole-state subscription it replaces.
// Naming them here makes that impossible to get wrong by accident.

import type { SignalingState } from "./signalingClient";

// ─── Single fields ────────────────────────────────────────────────────────
//
// These need no equality function: they come straight out of the state, so
// they are already stable whenever the state did not change them.

export const selectStatus = (s: SignalingState) => s.status;
export const selectName = (s: SignalingState) => s.name;
export const selectAccount = (s: SignalingState) => s.account;
export const selectRoom = (s: SignalingState) => s.room;
export const selectPeers = (s: SignalingState) => s.peers;
export const selectChatMessages = (s: SignalingState) => s.chatMessages;
export const selectVideoSources = (s: SignalingState) => s.videoSources;
export const selectAlertTarget = (s: SignalingState) => s.alertTarget;
export const selectSocialSeq = (s: SignalingState) => s.socialSeq;
export const selectAdsterraEnabled = (s: SignalingState) => s.adsterraEnabled;
export const selectDesktopUpdateSeq = (s: SignalingState) => s.desktopUpdateSeq;
export const selectRecentDms = (s: SignalingState) => s.recentDms;
export const selectLastThemeLike = (s: SignalingState) => s.lastThemeLike;
export const selectPresence = (s: SignalingState) => s.presence;
export const selectRoomRemoval = (s: SignalingState) => s.roomRemoval;

// ─── Multi-field slices ───────────────────────────────────────────────────
//
// Each builds a fresh object, so every one of these must be paired with
// `shallow` at the call site or it will report a change on every message —
// the exact thing this is here to stop.

export const selectDmNudge = (s: SignalingState) => ({
  lastDm: s.lastDm,
  dmSeq: s.dmSeq,
  alertTarget: s.alertTarget,
});

export const selectGiftNudge = (s: SignalingState) => ({
  lastGift: s.lastGift,
  lastGiftRedeemed: s.lastGiftRedeemed,
  alertTarget: s.alertTarget,
});

export const selectGroupNudge = (s: SignalingState) => ({
  lastGroupNotify: s.lastGroupNotify,
  groupNotifySeq: s.groupNotifySeq,
  alertTarget: s.alertTarget,
});

export const selectThemeLikeNudge = (s: SignalingState) => ({
  lastThemeLike: s.lastThemeLike,
  alertTarget: s.alertTarget,
});

export const selectCallNudge = (s: SignalingState) => ({
  incomingCalls: s.incomingCalls,
  outgoingCall: s.outgoingCall,
  callAccepted: s.callAccepted,
  callAcceptedSeq: s.callAcceptedSeq,
  callEnded: s.callEnded,
  callEndedSeq: s.callEndedSeq,
  alertTarget: s.alertTarget,
});

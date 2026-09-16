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
export const selectDmSeq = (s: SignalingState) => s.dmSeq;
export const selectDmReadSeq = (s: SignalingState) => s.dmReadSeq;
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

// ─── Whole-screen slices ──────────────────────────────────────────────────
//
// For the screens that read a handful of fields straight off the state as
// `state.x`: the same object shape, holding only those fields. Pair with
// `shallow`, like every multi-field slice.

function pickFields<K extends keyof SignalingState>(keys: readonly K[]) {
  return (s: SignalingState): Pick<SignalingState, K> => {
    const out = {} as Pick<SignalingState, K>;
    for (const key of keys) out[key] = s[key];
    return out;
  };
}

// The account menu and the Você screen: who is signed in, and the name.
export const selectAccountMenu = pickFields(["account", "name", "nameError"]);

// The site-wide announcement bar, always mounted.
export const selectAnnouncement = pickFields(["announcement", "announcementLive", "announcementSeq"]);

// Only the registered name — for the few screens that read nothing else.
export const selectNameSlice = pickFields(["name"]);

// The room settings dialog.
export const selectManageRoom = pickFields(["peers", "room", "roomAdmins", "roomBans", "roomLocation", "roomMemberLimit", "roomOwnerId", "roomPermissions", "selfUserId"]);

// A partner ad pushed by the server (PartnerCard, usePartnerAd).
export const selectPartnerPush = pickFields(["partner", "partnerSeq"]);

// The account card beside a room: who is signed in, and the name.
export const selectAccountName = pickFields(["account", "name"]);

// The supporters list pushed by the server.
export const selectSupportersPush = pickFields(["supporters", "supportersSeq"]);

// The home page's name gate.
export const selectHomePage = pickFields(["bannedReason", "name", "nameError", "status"]);

// A stream room's dashboard.
export const selectStreamDashboard = pickFields(["account", "deviceConflict", "name", "peers", "roomAdmins", "roomOwnerId", "selfUserId", "videoSources"]);

// A stream's viewer page.
export const selectStreamViewer = pickFields(["deviceConflict", "joinError", "joinErrorKind", "name", "peers", "room", "selfId", "videoSources"]);

// Everything a room (WatchRoom) reads — and nothing else. It used to take the
// whole state, so every friend's presence change, private message, group
// notification and gift anywhere on the account re-rendered the entire room,
// call included. Add a field here when the room starts reading one; the
// type (Pick) makes a missing one a compile error.
export const selectWatchRoom = pickFields(["account", "name", "music", "selfUserId", "peers", "status", "selfId", "roomMemberLimit", "nameError", "room", "videoSources", "roomOwnerId", "roomRemoval", "roomPermissions", "guestBroadcastLimit", "roomLocation", "roomDescription", "roomCategory", "roomAdmins", "permissionDenied", "roomTheme", "roomCreated", "joinError", "deviceConflict", "chatMessages", "bannedReason", "typingPeerIds", "selfDevice", "roomConverted", "permissionDeniedSeq", "myRoomPermissions", "joinErrorKind", "guestBroadcastLimitSeq", "chatBlockedMessage"]);

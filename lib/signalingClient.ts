"use client";

import { trackEvent } from "./analytics";
import type { VideoSource, VideoSourceKind } from "./videoSource";
import type { MusicSource, MusicSourceKind } from "./musicSource";
import type { Announcement } from "./announcement";
import type { Partner } from "./partner";
import type { Supporter } from "./supporter";
import { getAccountToken } from "./accountApi";
import {
  getCaptchaToken,
  isCaptchaScriptUnavailable,
  resetCaptchaScriptCache,
} from "./turnstile";
import { getBrowserFingerprint } from "./fingerprint";
import { BUILD_VERSION } from "./buildVersion";
import { currentAnnouncementDevice } from "./announcement";
import { getStoredGuestToken, setStoredGuestToken } from "./guestToken";
import { getInstallId } from "./installId";
import { isUserMentionedInMessage, containsBroadcastMention } from "./chatMentions";
import { showNotification } from "./notifications";

// `role: "moderator"` marks a moderator silently watching for moderation
// (see server/signaling.ts's "admin-join") — present in the peer list so
// this client's own useRoomMedia still opens a WebRTC connection to it like
// any other peer, but the UI (WatchRoom) filters it out of what's shown.
// One local file a peer is playing, as announced in "sharing" and echoed back
// by the server (see its ClientInfo.sharingFiles).
export type SharedFile = {
  // The broadcast channel carrying it — "file1".."file3". Also what a control
  // request is addressed to (see useRoomMedia's file-control signal).
  channel: string;
  name: string;
  // Which picker it came from. "music" is the room's soundtrack and belongs in
  // the bar under the header next to a YouTube one (see MusicBar); "video" is
  // something to watch and takes a tile. The channel carrying it is the same
  // either way — this is what says how to present what arrives on it.
  mode: "video" | "music";
  // "owner": only the person playing it may drive it. "anyone": everybody in
  // the room may, by asking that person's client to do it.
  controlMode: "owner" | "anyone";
  playing: boolean;
  positionSeconds: number;
  duration: number;
  index: number;
  count: number;
  // The announcing client's clock, for the position arithmetic. Stamped by the
  // server on arrival, so everyone extrapolates from one clock rather than
  // from the announcer's.
  updatedAt: number;
};

// Somebody a room banned. Mirrors the server's RoomBan (see roomStore.ts).
export type RoomBan = {
  id: string;
  name: string;
  bannedAt: number;
};

export type PeerInfo = {
  id: string;
  name: string;
  // Which of this person's devices in the room this connection is, 1..3 (see
  // the server's ClientInfo.deviceNo). Undefined from a server that predates
  // it, and — importantly — never rendered on its own: the "(2)" only appears
  // while `userId` has more than one device present, so somebody alone in the
  // room is never labelled. See lib/displayName.ts.
  device?: number;
  sharing: boolean;
  // Which of the two video channels the peer is broadcasting — `sharing` is
  // just the two OR-ed together. null when the peer's client never reported
  // the breakdown (older client), which is not the same as false: the admin
  // UI shows a generic "transmitindo" for null instead of guessing a
  // channel. Undefined only from a server that predates the fields.
  screen?: boolean | null;
  camera?: boolean | null;
  // The name of the local file this peer is playing into the room, when their
  // screen channel is carrying one rather than a screen (see
  // lib/localMediaSource.ts and the server's ClientInfo.sharingFile). Null
  // otherwise, and undefined from a server that predates it — both mean "an
  // ordinary transmission", which is how every reader treats them.
  //
  // What it is for: a local file arrives through the same channel as a screen
  // share and would otherwise be captioned as one. This is what lets its tile
  // be labelled as the video source it actually is.
  // Every local file this peer is currently playing into the room, one per
  // broadcast channel (see lib/localMediaSource.ts). Empty — or undefined from
  // a server that predates it — when they are playing none.
  //
  // Carries what a viewer's tile needs and nothing else: which file, who may
  // drive it, and the discrete playback facts everyone extrapolates a position
  // from (see localFilePosition). The picture itself arrives as live video on
  // the channel this names.
  files?: SharedFile[];
  mic: boolean;
  // Whether they have silenced everyone else's mic for themselves
  // ("silenciar microfones"). Their own listening setting — nothing about
  // what they transmit — shown in the participant list because talking to
  // somebody who cannot hear you is the one thing that list can save you
  // from. Undefined from a server that predates it, read as false.
  micsMuted?: boolean;
  role?: "moderator" | "obs";
  obsTarget?: string;
  // Stable per-account/per-guest identity (see server/signaling.ts's
  // stableUserId) — unlike `id`, which is reissued on every reconnect, this
  // stays the same across reloads for the same person. Undefined only for a
  // peer sent by an older server version that doesn't send it yet.
  userId?: string;
  // Not logged into a registered account (see server/signaling.ts's
  // peerSummary) — every name-displaying UI (ParticipantRow, VideoTile
  // labels, ChatPanel) renders this as a "(guest)" suffix via
  // lib/displayName.ts. Undefined only for a peer sent by an older server
  // version that doesn't send it yet — treated the same as `false`.
  isGuest?: boolean;
  // Account flags (e.g. "VERIFIED") — see RegisteredAccount.flags below.
  // Undefined for a guest, or a peer sent by an older server version that
  // doesn't include this yet; DisplayUserName treats both the same (no
  // badge). Only ever meaningful for a real account, never a guest name.
  flags?: string[];
  // Cosmetics-store name color (see lib/cosmetics.ts and
  // components/DisplayUserName's `color` prop) — the hex value of whichever
  // "name_color" product this peer has equipped, or null/undefined for none
  // (a guest, an account with nothing equipped, or a peer sent by an older
  // server version that doesn't include this yet).
  nameColor?: string | null;
  // On the GoLive desktop app rather than a browser (see
  // server/signaling.ts's peerSummary) — ParticipantRow shows a small app
  // icon for these. Undefined for a peer sent by an older server version
  // that doesn't include it yet, treated the same as `false`.
  app?: boolean;
  // On the GoLive Android app rather than a phone browser (see the server's
  // peerSummary). Its own field beside `app` rather than a value inside it —
  // ParticipantRow shows a phone icon for these and a monitor for those.
  // Undefined from a server that predates it, read the same as `false`.
  mobileApp?: boolean;
};

export type SignalingStatus = "idle" | "connecting" | "open" | "closed" | "superseded" | "banned";

// The room-level switches an owner/admin can turn off from "Gerenciar sala"
// (see server/roomStore.ts's RoomPermissions — this must stay in step with
// it). Turning one off doesn't remove the action from the room; it narrows
// it down to the owner and the admins they promoted.
export type RoomPermissionKey =
  | "mic"
  | "screen"
  | "camera"
  | "videoSource"
  | "chat"
  | "gif"
  | "image";

export type RoomPermissions = Record<RoomPermissionKey, boolean>;

// Everything is allowed until a server says otherwise — the same default the
// server creates a room with, and what this client assumes for a room whose
// settings it hasn't heard yet (an older server that never sends them).
export const DEFAULT_ROOM_PERMISSIONS: RoomPermissions = {
  mic: true,
  screen: true,
  camera: true,
  videoSource: true,
  chat: true,
  gif: true,
  image: true,
};

/**
 * Returns true if a peer is an OBS Browser Source connection (role === "obs" or name starts with OBS).
 * OBS peers must never appear as room participants, headcount, chat mentions, etc.
 */
export function isObsPeer(
  p: { role?: string; name?: string; obsTarget?: string } | null | undefined
): boolean {
  if (!p) return false;
  if (p.role === "obs") return true;
  if (p.obsTarget) return true;
  if (!p.name) return false;
  const trimmed = p.name.trim();
  return /^(?:OBS|Stream|Viewer|Fonte|Captura)(?:[:-]|\s|$)/i.test(trimmed);
}

// Someone the owner promoted to help run the room. `id` is a stable
// per-account/per-guest id (the same thing PeerInfo.userId carries), and
// `name` is their display name as of the promotion — used only to name an
// admin who isn't currently in the room; when they are, the live peer list's
// name is the better one.
export type RoomAdmin = {
  id: string;
  name: string;
};

// Where the room's owner/admins pinned it on the world map (see the /worldmap
// page and ManageRoomModal's "Definir local do mundo"). Null for a room
// nobody has placed.
export type RoomLocation = {
  lat: number;
  lng: number;
};

// Both are read defensively rather than cast: a server that predates room
// settings sends neither, and the honest reading of "nothing was said" is
// the wide-open default, not a locked-down room nobody can talk in.
function parseRoomPermissions(raw: unknown): RoomPermissions {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = { ...DEFAULT_ROOM_PERMISSIONS };
  for (const key of Object.keys(DEFAULT_ROOM_PERMISSIONS) as RoomPermissionKey[]) {
    if (typeof source[key] === "boolean") out[key] = source[key] as boolean;
  }
  return out;
}

// Mirrors the server's normalizeRoomLocation — anything that isn't a real
// point comes back as "not placed" rather than a marker in the void.
export function parseRoomLocation(raw: unknown): RoomLocation | null {
  if (!raw || typeof raw !== "object") return null;
  const { lat, lng } = raw as { lat?: unknown; lng?: unknown };
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function parseRoomAdmins(raw: unknown): RoomAdmin[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (entry): entry is RoomAdmin =>
        Boolean(entry) && typeof entry === "object" && typeof (entry as RoomAdmin).id === "string"
    )
    .map((entry) => ({ id: entry.id, name: typeof entry.name === "string" ? entry.name : "" }));
}


export type ChatReplyTo = {
  id: string;
  name: string;
  text?: string;
  kind?: "text" | "gif" | "image";
  images?: string[];
};

export type ChatMessage = {
  id: string;
  from: string;
  name: string;
  // Who sent it and from which of their devices — see PeerInfo.userId and
  // PeerInfo.device. Captured per-message at send time (the server's "chat"
  // handler), so history keeps saying which device said what. Absent on
  // anything sent before this existed, which reads as "no suffix".
  userId?: string;
  device?: number;
  // See PeerInfo.isGuest's doc comment — captured per-message at send time
  // (see server/signaling.ts's "chat" handler), same as `name`.
  isGuest?: boolean;
  // See PeerInfo.flags's doc comment.
  flags?: string[];
  // See PeerInfo.nameColor's doc comment.
  nameColor?: string | null;
  // "gif" is a link into Giphy's catalogue, "image" a file somebody uploaded
  // (see lib/chatImage.ts — it goes through the API, never straight to the
  // CDN); both carry the picture in `url`. Missing/anything else (including
  // messages persisted before this field existed) renders as plain text.
  kind?: "text" | "gif" | "image";
  text: string;
  url?: string;
  // Pictures attached to this message (see lib/chatImage.ts and the API's
  // POST /rooms/:handle/chat/images). Independent of `text` — a message can
  // be a caption with pictures, pictures alone, or neither. Absent on every
  // message from before this existed, where a lone picture arrives as
  // kind "image" with a single `url` instead.
  images?: string[];
  replyTo?: ChatReplyTo | null;
  ts: number;
};

// Echoed back by the server on "registered" (see server/signaling.ts) when
// this connection presented a valid account JWT — null for a guest.
export type RegisteredAccount = {
  username: string;
  flags: string[];
};

export type SignalingState = {
  status: SignalingStatus;
  selfId: string | null;
  // This connection's *stable* identity (account id, or the guest id minted
  // at register) — what a room video source is attributed to, and therefore
  // what says whether this viewer is the one allowed to steer it. The
  // connection id above changes on every reconnect and can't answer that.
  selfUserId: string | null;
  // This connection's own device number (see PeerInfo.device). Separate from
  // the peer list because this client is not in its own peer list, and the
  // participant row for "you" needs the same "(2)" everybody else sees.
  selfDevice: number | null;
  // Set when the server refused a join *pending a decision*: this account is
  // already in the room on another device. Not an error — the join is
  // waiting, not failed, and answering yes does not disconnect anything —
  // which is why it is its own field rather than a joinErrorKind.
  deviceConflict: { devices: number; maxDevices: number } | null;
  name: string | null;
  nameError: string | null;
  account: RegisteredAccount | null;
  room: string | null;
  // Set when the last "join" attempt failed for a reason that isn't a fresh
  // retry away: either the server rejected it outright because someone
  // else — a provably different guest/account, not just another connection
  // of ours — already holds this display name in that specific room (see
  // server/signaling.ts's "join" handler and the "join-error" case below),
  // or performJoin's captcha verification kept getting rejected past
  // MAX_JOIN_RETRIES. Cleared as soon as a room is actually entered or a
  // fresh join attempt starts. Distinct from nameError: that one is about
  // the name itself (format, or reserved by an account) and can block
  // before a room is even chosen; this one only ever happens once a room
  // was targeted.
  peers: PeerInfo[];
  chatMessages: ChatMessage[];
  // Videos added to the room from an external service (YouTube, today) — see
  // lib/videoSource.ts. Server-owned and room-scoped: a fresh "room-state"
  // replaces this wholesale, which is also what empties it on a room switch.
  videoSources: VideoSource[];
  // The room's one music source, or null when it has none (see
  // lib/musicSource.ts). Server-owned and room-scoped like videoSources
  // above: a fresh "room-state" replaces it wholesale, which is also what
  // clears it on a room switch.
  music: MusicSource | null;
  // Site-wide banner, independent of room — null when none is active. Set
  // from the server's "announcement" push (see server/signaling.ts's
  // broadcastToAll), which also fires once right after "welcome" for a
  // fresh connection so a page opened while one's active still sees it
  // (only when the announcement's visibility is "all" — see the server).
  announcement: Announcement | null;
  // Whether the *most recent* "announcement" delivery was a live one (this
  // connection was already open when it was sent/edited) rather than a
  // catch-up delivery to a freshly opened connection — mirrors the
  // server's `live` flag on that message. Read alongside `announcement` by
  // AnnouncementBanner.tsx to decide whether to play the "live-only" sound.
  announcementLive: boolean;
  // Bumped every time an "announcement" message is actually processed
  // (whatever its value, including a clear). A "visibility: online-only"
  // announcement is, *by design*, never pushed to a fresh connection at
  // all (see the server), so `announcement` can legitimately stay `null`
  // here forever even while one is genuinely active — this counter is what
  // lets AnnouncementBanner.tsx's localStorage fallback tell "nothing's
  // arrived yet, so I don't actually know" apart from "a message arrived
  // and it said null," which is the only case that should make it drop its
  // cached persistent announcement.
  announcementSeq: number;
  // Sidebar partner-ad slot (see components/PartnerCard.tsx and
  // server/signaling.ts's broadcastPartnerUpdate) — unlike `announcement`,
  // this is *never* pushed automatically on connect; PartnerCard.tsx always
  // fetches its initial value over plain HTTP (GET /partner, which is where
  // the "show nothing X% of the time" roll happens) and only uses this for
  // *live* updates while already mounted. `partnerSeq` (mirrors
  // announcementSeq) is what lets it tell "no live update has arrived, keep
  // showing what HTTP gave me" apart from "a live update arrived and it
  // said null" — both look identical as a bare `partner: null` otherwise.
  partner: Partner | null;
  partnerSeq: number;
  // Whether the Adsterra slots are switched on (see the API's /ads/config and
  // the admin panel's AdsterraPanel). Same fetch-over-HTTP-then-live-update
  // shape as `partner` above, and the same reason for the counter: null here
  // means "nothing has told us yet, keep whatever HTTP said" rather than
  // "off", which matters because turning ads off has to look different from
  // not having asked yet.
  adsterraEnabled: boolean | null;
  adsConfigSeq: number;
  // Bumped whenever anything about this account's friends or blocks changes,
  // from any device (see the API's socialRoutes notifyPair). A counter, not
  // the graph itself: the change is always "something moved, re-read it", and
  // shipping a patch instead would mean two copies of the graph that can
  // disagree — which for "are we friends?" is the one thing that must not
  // happen. See lib/useSocialGraph.ts.
  socialSeq: number;
  // "Apoiar projeto" hover list (see SupportersTooltip.tsx) — same
  // fetch-over-HTTP-then-live-update shape as partner above, minus the
  // "null means nothing to show" ambiguity: an empty array already means
  // that on its own, so this doesn't need a null variant, just the same
  // supportersSeq trick to tell "no live update yet" apart from "a live
  // update arrived" (relevant the day someone clears the list down to
  // empty via a live edit rather than just never having set it).
  supporters: Supporter[];
  supportersSeq: number;
  // Bumped by the admin panel's "lançar atualização" broadcast (see
  // server/signaling.ts's POST /admin/desktop-update). A counter rather than
  // a flag because the message carries nothing and has no lasting state —
  // the *event* is the whole payload, and a boolean would have no honest
  // value to go back to after it fired. Only UpdateAppButton reads it, and
  // only inside the desktop shell; everywhere else it just counts.
  desktopUpdateSeq: number;
  // Set when the server rejected our last chat message for containing a
  // banned word (see server/signaling.ts's "chat-blocked") — cleared as
  // soon as another send is attempted, so it's a one-shot warning rather
  // than a persistent banner.
  chatBlockedMessage: string | null;
  // Why this connection was banned, when the server said (see its "banned"
  // message). Null both when there's no ban and when there is one it can't
  // explain: an IP ban is rejected at the WebSocket upgrade itself, before
  // there's a connection to send anything over, so `status === "banned"` with
  // a null reason here is the norm, not an anomaly.
  bannedReason: string | null;
  joinError: string | null;
  // Which kind of refusal `joinError` describes, because the two need
  // different screens and different controls, and used to be
  // indistinguishable — every failure got the same "choose another name"
  // form, which is only ever the right answer for one of them.
  //   "name"    — the name is taken in this room; a rename is the way in.
  //   "full"    — the room hit its member limit; retrying later or going
  //               elsewhere is all there is, a rename does nothing.
  //   "banned"  — thrown out of this room; nothing to retry, support is the
  //               only recourse.
  //   "captcha" — the security check (its own screen above).
  //   "generic" — everything else (a code-less private handle, a rate limit,
  //               or an unrecognised reason from a newer/older server):
  //               retry, home and support, but no misleading rename box.
  joinErrorKind: "name" | "full" | "banned" | "captcha" | "device-limit" | "obs-unauthorized" | "streamer-mode-disabled" | "rate-limited" | "generic" | null;
  // There used to be a `captchaChallenge` pair here, driving a modal this
  // client opened when the server said the invisible check had refused the
  // join but a challenge was available. Turnstile owns that step now: it
  // decides in the browser whether this person is shown anything, and does it
  // before the join is ever sent (see lib/turnstile.ts). So a "captcha-required"
  // that still arrives is a plain failure again, and joinError/joinErrorKind
  // are enough to say so.
  // Who runs this room and what it currently allows — pushed on join
  // (inside "room-state") and again on every change ("room-settings"), so
  // these are never stale for anyone who was already here. `roomOwnerId` and
  // each `roomAdmins` entry's id are stable user ids, comparable against
  // PeerInfo.userId / `selfUserId` above — never against a connection id.
  roomOwnerId: string | null;
  roomAdmins: RoomAdmin[];
  // Who this room threw out for good (see the server's "room-ban"). Only ever
  // sent to the room's owner and admins — a list of names of people a room
  // banned is not something the room at large needs — so it is empty for
  // everyone else, and empty until it is asked for (see requestRoomBans).
  roomBans: RoomBan[];
  // How many ordinary members this room accepts at once, or null for no limit
  // (see the server's join gate). Public, unlike roomBans — a room being full
  // is not a secret, and it is what lets the UI say so.
  roomMemberLimit: number | null;
  // Set when this room removed *us*: `banned` tells "you may not come back"
  // apart from "you were kicked out of this one". Null the rest of the time,
  // and cleared on the next join, so it only ever describes what just
  // happened.
  roomRemoval: { banned: boolean } | null;
  roomPermissions: RoomPermissions;
  // Whether the join that produced the room state we're holding is the one
  // that *created* the room, as opposed to walking into one already running
  // (see the server's "room-state"). False for everyone but its creator, and
  // false again for a room restored from its persisted record — that owner
  // has already been offered everything a new room gets offered. Read once,
  // on arrival, by WatchRoom's "you just created a public room" popup.
  roomCreated: boolean;
  // Where this room sits on the public room map — null until an owner/admin
  // places it. Kept here rather than fetched, so the "Definir local do
  // mundo" view opens on the pin that's already there.
  roomLocation: RoomLocation | null;
  // The room's blurb and category (see lib/roomCategories) — "" and null when
  // unset. Set by the owner/admins from the room header, and shown wherever a
  // room is listed.
  roomDescription: string;
  roomCategory: string | null;
  // The last action this room refused us (see the server's
  // "room-permission-denied"). Carried alongside a counter because the
  // *event* is what matters — being refused the mic twice in a row is two
  // things to react to, and a bare object would look unchanged the second
  // time. WatchRoom watches the counter to actually stop whatever was
  // started locally before the server had its say.
  permissionDenied: { permission: RoomPermissionKey; message: string } | null;
  permissionDeniedSeq: number;
  // Ids (PeerInfo.id) of peers currently shown as "typing..." in the chat
  // (see ChatPanel.tsx) — purely a live relay (server/signaling.ts's
  // "peer-typing"), nothing persisted or replayed on join. Each entry is
  // also backed by a client-side expiry timer (see handleMessage's
  // "peer-typing" case) as a safety net for a lost/never-sent explicit
  // "false" — e.g. the typer's tab closing outright.
  typingPeerIds: string[];
};

type Listener = () => void;
type SignalListener = (from: string, data: Record<string, unknown>) => void;

const WS_URL = process.env.NEXT_PUBLIC_SIGNALING_URL || "ws://localhost:4000/ws";
const NAME_STORAGE_KEY = "sharescreen:name";
// Deliberately sessionStorage, not localStorage: this id is echoed to every
// peer in whatever room it's used in (see peerSummary/room-state on the
// server), so it must stay scoped to *this tab* rather than being shared
// browser-wide — otherwise a second tab opened for a different room would
// immediately steal it back and forth with the first (see
// SUPERSEDED_CLOSE_CODE below), even though the two tabs have nothing to do
// with each other. A reload of this same tab still reclaims it, since
// sessionStorage survives that; a brand new tab simply starts fresh.
const CLIENT_ID_STORAGE_KEY = "sharescreen:clientId";
// Mirrors server/signaling.ts's SUPERSEDED_CLOSE_CODE.
const SUPERSEDED_CLOSE_CODE = 4000;
// Mirrors server/signaling.ts's BANNED_CLOSE_CODE.
const BANNED_CLOSE_CODE = 4003;

const initialState: SignalingState = {
  status: "idle",
  selfId: null,
  selfUserId: null,
  selfDevice: null,
  deviceConflict: null,
  name: null,
  nameError: null,
  account: null,
  room: null,
  bannedReason: null,
  joinError: null,
  joinErrorKind: null,
  peers: [],
  chatMessages: [],
  videoSources: [],
  announcement: null,
  announcementLive: false,
  announcementSeq: 0,
  partner: null,
  partnerSeq: 0,
  adsterraEnabled: null,
  adsConfigSeq: 0,
  socialSeq: 0,
  supporters: [],
  supportersSeq: 0,
  desktopUpdateSeq: 0,
  chatBlockedMessage: null,
  music: null,
  roomCreated: false,
  roomOwnerId: null,
  roomAdmins: [],
  roomBans: [],
  roomMemberLimit: null,
  roomRemoval: null,
  roomPermissions: { ...DEFAULT_ROOM_PERMISSIONS },
  roomLocation: null,
  roomDescription: "",
  roomCategory: null,
  permissionDenied: null,
  permissionDeniedSeq: 0,
  typingPeerIds: [],
};

// Safety-net expiry for a peer's "typing" state — see typingPeerIds' doc
// comment. Comfortably longer than ChatPanel's own idle-driven "stop typing"
// send, so a healthy connection never hits this at all; it only matters when
// the explicit "false" is lost.
const TYPING_EXPIRE_MS = 6000;

// Where the "this address already passed" window is remembered across page
// loads — see SignalingClient.captchaVerifiedAt for why it has to survive one.
// Mirrors the server's own CAPTCHA_REVERIFY_INTERVAL_MS window; a value older
// than that is simply ignored rather than cleaned up.
const CAPTCHA_VERIFIED_STORAGE_KEY = "sharescreen:captchaVerifiedAt";

function readStoredCaptchaVerifiedAt(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CAPTCHA_VERIFIED_STORAGE_KEY);
    if (!raw) return null;
    const at = Number(raw);
    // A timestamp from the future is a clock that moved, not a pass — and
    // trusting one would skip the check for as long as the skew lasts.
    if (!Number.isFinite(at) || at > Date.now()) return null;
    return Date.now() - at < CAPTCHA_REVERIFY_INTERVAL_MS ? at : null;
  } catch {
    return null;
  }
}

function writeStoredCaptchaVerifiedAt(at: number | null): void {
  if (typeof window === "undefined") return;
  try {
    if (at === null) window.localStorage.removeItem(CAPTCHA_VERIFIED_STORAGE_KEY);
    else window.localStorage.setItem(CAPTCHA_VERIFIED_STORAGE_KEY, String(at));
  } catch {
    // ignored - localStorage may be unavailable (private mode, quota, etc.)
  }
}

// How many times performJoin auto-retries after a "captcha-required"
// rejection (fetching a fresh token each time) before giving up and
// surfacing joinError instead — covers a token expiring in flight or one bad
// verification call without retrying forever if Turnstile is genuinely
// broken (blocked by an extension, network issue, misconfigured site key).
const MAX_JOIN_RETRIES = 3;

// How long to wait for the server to answer a "register" before treating the
// connection as dead and starting over.
//
// Every other recovery path in this client hangs off the socket closing, which
// leaves one hole: a socket that opens fine, carries the register, and is then
// never answered. Nothing closes, so nothing retries, and the client sits at
// status "open" with no name forever — which the home page renders as
// "Reconectando..." with no reconnect actually pending. Anything can put it
// there: a server restarting between the upgrade and the message, a proxy that
// half-closes without a close frame, a slow account lookup on the far side.
// Generous enough that a genuinely slow answer is never cut off, short enough
// to resolve before the page starts telling the user something is wrong.
const REGISTER_ACK_TIMEOUT_MS = 10_000;
// Mirrors server/signaling.ts's CAPTCHA_REVERIFY_INTERVAL_MS — purely an
// optimization to skip a pointless getCaptchaToken() call once the server
// would reject a stale connection-level verification anyway; the server is
// the actual source of truth (a mismatch here just costs one extra
// "captcha-required" round trip, already handled by performJoin's retry).
const CAPTCHA_REVERIFY_INTERVAL_MS = 30 * 60_000;

/**
 * How long a peer we already knew may stay in the list after a reconnect
 * without the server having mentioned them again.
 *
 * When the signaling server restarts, every socket in every room drops at
 * once and each client reconnects on its own jittered backoff. So the first
 * room-state a client gets back is not a picture of the room — it is a
 * picture of whoever happened to reconnect first, which is frequently nobody.
 * Taking it literally is what made a restart look like everyone left and then
 * filed back in one at a time, chiming as they went, while their screen share
 * carried on playing throughout: the media never dropped, because WebRTC is
 * peer-to-peer and does not care that the signaling server went away.
 *
 * Deliberately the same 5s as useRoomMedia's PEER_PRUNE_GRACE_MS, which is
 * the identical judgement one layer down — it already refuses to tear down a
 * peer connection missing from a fresh room-state for exactly this long. The
 * two have to agree: a shorter window here drops people from the list whose
 * video is still on screen, a longer one keeps names for peers whose
 * connection has already been torn down.
 */
export const PEER_RESETTLE_MS = 5000;

// Cap on retained chat history per room, to keep memory bounded in a
// long-running room instead of growing the array forever.
const MAX_CHAT_MESSAGES = 200;

export function getStoredName(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(NAME_STORAGE_KEY);
  } catch {
    return null;
  }
}

function setStoredName(name: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (name) window.localStorage.setItem(NAME_STORAGE_KEY, name);
    else window.localStorage.removeItem(NAME_STORAGE_KEY);
  } catch {
    // ignored - localStorage may be unavailable (private mode, quota, etc.)
  }
}

// A stable per-tab connection id, persisted across reloads and reconnects
// of *this tab* (including after the signaling server itself restarts for a
// deploy) so a returning client can reclaim its previous identity instead
// of showing up as a stranger — which would otherwise orphan everyone
// else's still-open WebRTC connections to it. The server adopts whatever id
// we send it once registered, so this also self-heals if it's ever out of
// sync. sessionStorage (not localStorage) deliberately keeps this scoped to
// one tab — see CLIENT_ID_STORAGE_KEY above.
function getClientId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(CLIENT_ID_STORAGE_KEY);
  } catch {
    return null;
  }
}

// Rooms this tab has already answered the other-device question for.
//
// Without this the question comes back on every reconnect, which is not a
// rare event: a phone changing networks, a laptop waking, a deploy dropping
// every socket at once. Each of those re-registers and re-joins, the other
// device is still sitting there, and the server — which has no memory of a
// decision, only of who is present — asks again. Being asked to confirm
// something you confirmed thirty seconds ago reads as the app having lost
// track, and after a deploy it would ask everybody at once.
//
// sessionStorage, so it is scoped to exactly one tab and survives exactly one
// thing: a reload of that tab. A genuinely new tab is a genuinely new device
// and gets asked, which is the whole point of the question.
const DEVICE_CONFIRMED_STORAGE_KEY = "sharescreen:deviceConfirmedRooms";

function readConfirmedDeviceRooms(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.sessionStorage.getItem(DEVICE_CONFIRMED_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return new Set(Array.isArray(parsed) ? parsed.filter((r): r is string => typeof r === "string") : []);
  } catch {
    return new Set();
  }
}

function writeConfirmedDeviceRooms(rooms: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(DEVICE_CONFIRMED_STORAGE_KEY, JSON.stringify([...rooms]));
  } catch {
    // ignored - sessionStorage may be unavailable (private mode, quota, etc.)
  }
}

function setClientId(id: string) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(CLIENT_ID_STORAGE_KEY, id);
  } catch {
    // ignored - sessionStorage may be unavailable (private mode, quota, etc.)
  }
}


class SignalingClient {
  private ws: WebSocket | null = null;
  // How far this browser's clock is behind the server's, in ms (see
  // serverNow). Zero until the first sample lands, which is the honest
  // starting point: no measurement yet means no correction.
  private clockOffsetMs = 0;
  // The round trip of the sample the offset came from. Kept so a later,
  // noisier sample doesn't overwrite a better one — the shortest round trip
  // is the one where the server's timestamp is least ambiguous, which is the
  // same reason NTP picks its samples that way.
  private clockSampleRttMs = Number.POSITIVE_INFINITY;
  private clockSyncTimer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<Listener>();
  private signalListeners = new Set<SignalListener>();
  private roomJoinedListeners = new Set<Listener>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private desiredName: string | null = null;
  // The account JWT to (re)send with every "register" — null for a guest.
  // Kept alongside desiredName so a reconnect re-authenticates the same way
  // the original register() call did.
  private desiredToken: string | null = null;
  private desiredRoom: string | null = null;
  private isObsSourceJoin = false;
  private obsSourceToken: string | null = null;
  private obsTarget: string | null = null;
  private pendingObsTokenRequests = new Map<
    string,
    {
      resolve: (token: string) => void;
      reject: (err: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  // Last reported state of each video channel — see setSharing, which merges
  // into this rather than overwriting, so one channel's update never claims
  // anything about the other.
  private sharingSources: {
    screen: boolean;
    camera: boolean;
    files: Omit<SharedFile, "updatedAt">[];
  } = { screen: false, camera: false, files: [] };
  // Consecutive "captcha-required" rejections for the current join
  // attempt — see MAX_JOIN_RETRIES and performJoin.
  private joinRetryCount = 0;
  // When this browser last passed a challenge: later joins within
  // CAPTCHA_REVERIFY_INTERVAL_MS skip fetching a token entirely, because
  // the server would wave them through anyway (see its
  // captchaVerifiedIps).
  //
  // Deliberately *not* reset when a new WebSocket opens, which it used to
  // be. That reset assumed the server forgot on every reconnect — true back
  // when its only memory was per-socket, and the reason a phone changing
  // networks or a laptop waking up meant another challenge. Both sides now
  // remember for the same window, so a reconnect costs nothing. If the two
  // ever disagree, the server says so with "captcha-required" and
  // performJoin retries with a real token, which is the same safety net
  // that has always backed this optimization.
  //
  // Persisted, and that is not a micro-optimization: the server's own memory
  // of this address (captchaVerifiedIps) outlives the page, so an in-memory
  // value meant every reload — opening a room link, which is *the* way people
  // arrive here — minted a token the server was about to ignore anyway. With
  // reCAPTCHA that was an unnoticed 200ms. With Turnstile it is a widget doing
  // real browser work, and it was the difference between joining instantly and
  // waiting seconds for permission nobody was going to ask for.
  private captchaVerifiedAt: number | null = readStoredCaptchaVerifiedAt();
  // See readConfirmedDeviceRooms — which rooms this tab has already said
  // "yes, let me in anyway" for.
  private confirmedDeviceRooms: Set<string> = readConfirmedDeviceRooms();
  private streamerMode: boolean = false;
  // Peers carried over a reconnect that the server has not re-announced yet
  // (see PEER_RESETTLE_MS). Emptied as each one is confirmed by a
  // "peer-joined"; whatever is left when the timer fires genuinely went away
  // while we were disconnected.
  private provisionalPeerIds = new Set<string>();
  private resettleTimer: ReturnType<typeof setTimeout> | null = null;
  // Whether the join now in flight actually carried a token. Read only by the
  // "captcha-required" handler: a refusal for "missing" means something very
  // different depending on this. Having sent nothing on purpose (the window
  // above said we were still verified, and the server disagreed) is fixed
  // completely by retrying *with* a token. Having sent nothing because none
  // could be minted is not fixed by anything, and retrying just spends the
  // budget on a foregone conclusion.
  private lastJoinSentToken = false;
  // Per-peer safety-net expiry timers backing typingPeerIds — see that
  // field's doc comment and TYPING_EXPIRE_MS.
  private typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // Set by connect() below — lets a connection stay open (and reconnect
  // after a drop, see scheduleReconnect) purely to receive site-wide pushes
  // like the announcement banner, for a visitor who hasn't registered a name
  // yet and so has no desiredName of their own.
  private wantsConnection = false;
  // Backs REGISTER_ACK_TIMEOUT_MS.
  private registerAckTimer: ReturnType<typeof setTimeout> | null = null;
  // The socket a "registered" was last received on. Compared by identity, not
  // by `state.name`: that survives reconnects, so it cannot answer "has *this*
  // connection been registered", which is the only question the ack timeout is
  // asking. It is also what keeps a rename — a register sent on an already
  // registered socket — from being able to trip the timeout.
  private registeredSocket: WebSocket | null = null;

  state: SignalingState = initialState;

  constructor() {
    // A stored account token takes over identity entirely — page.tsx
    // resolves it to the account's display name (via accountApi.fetchMe)
    // and calls register(name, token) itself, so auto-registering from the
    // plain guest name here would just get immediately overwritten (or
    // rejected as a name reserved by that very account).
    if (getAccountToken()) return;
    const storedName = getStoredName();
    if (storedName) this.register(storedName);
  }

  subscribe = (cb: Listener) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  getSnapshot = () => this.state;

  onSignal(cb: SignalListener) {
    this.signalListeners.add(cb);
    return () => this.signalListeners.delete(cb);
  }

  // Fires every time room-state is received, including after a reconnect
  // rejoins the same room — lets media channels re-announce sharing/mic
  // state, which the server resets to false for the new socket.
  onRoomJoined(cb: Listener) {
    this.roomJoinedListeners.add(cb);
    return () => this.roomJoinedListeners.delete(cb);
  }

  private setState(patch: Partial<SignalingState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  private clearTyping(id: string) {
    const timer = this.typingTimers.get(id);
    if (timer) clearTimeout(timer);
    this.typingTimers.delete(id);
    if (this.state.typingPeerIds.includes(id)) {
      this.setState({ typingPeerIds: this.state.typingPeerIds.filter((pid) => pid !== id) });
    }
  }

  // Room switches and leaves both start from a clean slate — a peer from the
  // room being left has no bearing on whether someone's typing in the new
  // one (or in no room at all).
  private clearAllTyping() {
    this.typingTimers.forEach((timer) => clearTimeout(timer));
    this.typingTimers.clear();
    if (this.state.typingPeerIds.length > 0) this.setState({ typingPeerIds: [] });
  }

  private ensureSocket() {
    if (typeof window === "undefined") return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.setState({ status: "connecting" });
    const ws = new WebSocket(WS_URL);
    this.ws = ws;

    ws.onopen = () => {
      // A socket this client has already replaced must not report anything
      // about the current one. Without the guard a stale close in particular
      // could wipe `desiredName` (see the banned branch below) and silently
      // disable reconnection for a connection that is perfectly healthy.
      if (this.ws !== ws) return;
      this.reconnectAttempts = 0;
      this.setState({ status: "open" });
      this.startClockSync();
      if (this.desiredName) this.sendRegister(this.desiredName);
    };

    ws.onmessage = (event) => {
      if (this.ws !== ws) return;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return;
      }
      this.handleMessage(msg);
    };

    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      this.clearRegisterAck();
      // Deliberately keep the last-known room/peers instead of blanking
      // them: the underlying WebRTC connections to those peers are
      // untouched by a brief signaling hiccup, so wiping the list here
      // made participants (and their sharing/mic dots) flicker away and
      // reappear even though their audio/video never actually stopped.
      // Once we reconnect, a fresh room-state reconciles anything that's
      // genuinely stale (see the pruning in useRoomMedia's onRoomJoined).
      // Code 4000 (see server/signaling.ts's detachSession) means another
      // connection — a second tab, or a reload that briefly overlapped the
      // old connection — just reclaimed this exact clientId. Reconnecting
      // would only reclaim it right back, kicking that one instead: without
      // this check the two sockets alternate forever, each resetting its
      // own backoff every time it briefly wins, never settling. Surface it
      // as a distinct status instead of "closed" so the UI can tell the
      // user what happened rather than looking like it's stuck reconnecting.
      if (event.code === SUPERSEDED_CLOSE_CODE) {
        this.setState({ status: "superseded" });
        return;
      }
      // Mirrors the superseded case above: reconnecting would just get
      // rejected again immediately (the ban is checked on every "/ws"
      // upgrade), so stop retrying and surface it instead of looking stuck.
      if (event.code === BANNED_CLOSE_CODE) {
        this.desiredName = null;
        this.setState({ status: "banned" });
        return;
      }
      this.setState({ status: "closed" });
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || (!this.desiredName && !this.wantsConnection)) return;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 10000);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureSocket();
    }, delay);
  }

  private handleMessage(msg: Record<string, unknown>) {
    switch (msg.type) {
      case "welcome":
        this.setState({ selfId: msg.id as string });
        break;
      case "registered": {
        this.clearRegisterAck();
        // Whether this socket had already been registered before this
        // message — i.e. whether this is a *reply to a re-register* rather
        // than the answer to a fresh one. Read before the assignment below,
        // which is what makes it true from here on.
        //
        // Two things provoke a re-register on an established socket, and
        // neither is a new arrival: the guest-token echo a few lines down,
        // and a rename (which a cosmetics purchase also performs — see
        // lib/cosmetics.ts). The same discriminator already draws this line
        // for the register timeout below; see registeredSocket's use there.
        const isReRegister = this.registeredSocket === this.ws;
        this.registeredSocket = this.ws;
        const account = (msg.account as RegisteredAccount | null) ?? null;
        const guestToken = typeof msg.guestToken === "string" ? msg.guestToken : null;
        // A guest identity token is only ever sent when the server minted a
        // new one for us (see server/signaling.ts) — persist it and start
        // presenting it on every future register() so this guest can prove
        // it's still the same one (that's what lets a reload or a second
        // tab reclaim its spot without some other request being able to
        // impersonate it — see isSameOwner server-side).
        let justMintedGuestToken = false;
        if (!account && guestToken) {
          setStoredGuestToken(guestToken);
          this.desiredToken = guestToken;
          justMintedGuestToken = true;
        }
        this.setState({
          name: msg.name as string,
          nameError: null,
          selfId: msg.id as string,
          account,
        });
        // A guest's name is remembered locally so it can be restored on
        // the next visit; an account's isn't, since accountApi's own
        // stored token is what drives auto-login next time (see the
        // constructor above) and re-persisting it here would just leave a
        // stale guest name behind after a logout.
        if (!account) setStoredName(msg.name as string);
        setClientId(msg.id as string);
        trackEvent("name_registered");
        // A freshly minted guest token only protects this connection once
        // the server has actually seen it presented back (see isSameOwner
        // and "registered"/"join" server-side) — until then someone who
        // observes this connection's id/name from a room's peer list could
        // still claim it the old (unprotected) way. Immediately presenting
        // it back on this same connection, rather than waiting for the next
        // natural reconnect, closes that window down to one round trip
        // instead of leaving it open for as long as this tab stays open.
        if (justMintedGuestToken) {
          this.rawSend({
            type: "register",
            name: msg.name,
            clientId: getClientId(),
            token: guestToken,
            fingerprint: getBrowserFingerprint(),
            device: currentAnnouncementDevice(),
            installId: getInstallId(),
            version: BUILD_VERSION,
          });
        }
        // A fresh registration (initial connect, or reconnect) counts as a
        // new join attempt — reset the retry budget rather than carrying
        // over count from whatever happened before the connection dropped.
        //
        // A *re*-registration is not one, and treating it as one is how the
        // captcha came up twice on the way into a room. The echo above sends
        // a second "register" on this same socket, the server answers it with
        // a second "registered", and this used to fire a second join for a
        // room the first join was already fetching a token for. Each join
        // mints its own single-use Turnstile token (see performJoin), so on
        // the occasions Cloudflare wanted to challenge, it challenged twice —
        // once before the room loaded and once after, since join #1 landed in
        // between. A rename does the same thing for the same reason, which is
        // its own small bug: the rename is already announced to the room from
        // the register handler server-side, so the join it provoked was pure
        // duplicate work carrying a pure duplicate captcha.
        if (this.desiredRoom && !isReRegister) {
          this.joinRetryCount = 0;
          void this.performJoin(this.desiredRoom);
        }
        break;
      }
      // Banned on something only knowable once registered — the account or
      // the browser fingerprint. The socket close that follows is what puts
      // this client into the "banned" status; this message only carries the
      // reason to show there.
      case "banned":
        this.clearRegisterAck();
        this.setState({ bannedReason: typeof msg.reason === "string" ? msg.reason : null });
        break;
      case "register-error":
        this.clearRegisterAck();
        this.setState({ nameError: msg.message as string });
        // If we already had a confirmed name, this was a rename attempt —
        // fall back to it instead of abandoning an otherwise-working
        // session (which would also stop future reconnects from
        // re-registering at all, since desiredName would be null).
        if (this.state.name) {
          this.desiredName = this.state.name;
        } else {
          this.desiredName = null;
          this.desiredToken = null;
          setStoredName(null);
        }
        trackEvent("name_register_error");
        break;
      // The name we hold is already taken by a provably different
      // guest/account in the room we just tried to join (see
      // server/signaling.ts's "join" handler) — surfaced separately from
      // register-error since, unlike that one, our name registration itself
      // was fine; only entering *this* room failed.
      case "join-error": {
        // Kept before it is cleared: the other-device branch below is a
        // question, not a refusal, and answering it has to resume the join
        // for *this* room rather than for whatever desiredRoom became.
        const refusedRoom = this.desiredRoom;
        this.desiredRoom = null;
        // The server tags each refusal with a `reason` (see its join handler);
        // the booleans are the older signal an out-of-date server still sends,
        // read as a fallback so this keeps working across a deploy. Anything
        // unrecognised is "generic" — a real failure with honest controls,
        // never the rename box, which was the whole bug.
        const reason = typeof msg.reason === "string" ? msg.reason : "";
        // Already in this room on another device, and the server is asking
        // rather than refusing. Handled before everything below because it is
        // not a failure: desiredRoom is deliberately put *back*, so answering
        // yes resumes the join that is still pending rather than starting a
        // new one, exactly as the captcha challenge used to.
        if (reason === "other-device") {
          this.desiredRoom = refusedRoom;
          this.setState({
            deviceConflict: {
              devices: typeof msg.devices === "number" ? msg.devices : 1,
              maxDevices: typeof msg.maxDevices === "number" ? msg.maxDevices : 3,
            },
            joinError: null,
            joinErrorKind: null,
          });
          break;
        }
        const kind: SignalingState["joinErrorKind"] =
          reason === "name-taken"
            ? "name"
            : reason === "full" || msg.full === true
              ? "full"
              : reason === "banned" || msg.banned === true
                ? "banned"
                : reason === "device-limit"
                  ? "device-limit"
                  : reason === "obs-unauthorized"
                    ? "obs-unauthorized"
                    : reason === "streamer-mode-disabled"
                      ? "streamer-mode-disabled"
                      : reason === "rate-limited"
                        ? "rate-limited"
                        : "generic";
        this.setState({
          joinError: (msg.message as string) ?? "Não foi possível entrar nesta sala.",
          joinErrorKind: kind,
          // A refusal ends any pending question about it.
          deviceConflict: null,
        });
        trackEvent("join_error");
        break;
      }
      case "room-state": {
        // The server sends the room's full retained chat history (kept for
        // the room's lifetime — see server/signaling.ts) on every join,
        // including a room switch, so a newcomer sees what was said before
        // they arrived.
        const history = Array.isArray(msg.messages) ? (msg.messages as ChatMessage[]) : [];
        this.joinRetryCount = 0;
        this.markCaptchaVerified();
        this.clearAllTyping();
        this.setState({
          room: msg.room as string,
          selfId: msg.selfId as string,
          selfUserId: (msg.selfUserId as string | undefined) ?? null,
          selfDevice: typeof msg.selfDevice === "number" ? msg.selfDevice : null,
          // We are in; whatever was being asked about getting in is settled.
          deviceConflict: null,
          joinError: null,
          joinErrorKind: null,
          peers: this.peersForRoomState(msg.room as string, msg.peers as PeerInfo[]),
          chatMessages:
            history.length > MAX_CHAT_MESSAGES ? history.slice(-MAX_CHAT_MESSAGES) : history,
          videoSources: Array.isArray(msg.videoSources) ? (msg.videoSources as VideoSource[]) : [],
          // Null both for a room with no music and for a server that predates
          // the feature — the bar simply doesn't render in either case.
          music: (msg.music as MusicSource | null | undefined) ?? null,
          roomCreated: msg.created === true,
          roomOwnerId: typeof msg.ownerId === "string" ? msg.ownerId : null,
          roomAdmins: parseRoomAdmins(msg.admins),
          roomMemberLimit: typeof msg.memberLimit === "number" ? msg.memberLimit : null,
          // A fresh join is a fresh answer to "was I thrown out", and the
          // answer is no — we are in.
          roomRemoval: null,
          roomPermissions: parseRoomPermissions(msg.permissions),
          roomLocation: parseRoomLocation(msg.location),
          roomDescription: typeof msg.description === "string" ? msg.description : "",
          roomCategory: typeof msg.category === "string" ? msg.category : null,
          // A refusal from the room we just left says nothing about this one.
          permissionDenied: null,
        });
        trackEvent("room_joined");
        this.roomJoinedListeners.forEach((l) => l());
        break;
      }
      // The server's server/captcha.ts rejected (or never received) a
      // valid token for our last "join" — see performJoin, which mints a
      // fresh one per attempt since each is single-use.
      //
      // Rarer than it used to be, and for a good reason: this used to also
      // cover "your reCAPTCHA score was below the threshold", which no amount
      // of retrying could change. Turnstile has no score — it shows a
      // challenge to whoever it is unsure about, in the browser, before the
      // join is sent — so what is left here is a token that expired, was
      // already spent, or never got minted at all. The retry cap stays for
      // the last of those.
      case "captcha-required": {
        if (!this.desiredRoom) break;
        // The server just contradicted whatever this client believed about
        // being verified, so drop that belief before retrying — otherwise
        // performJoin's freshness check short-circuits, sends a null token
        // again, and the retry loop burns MAX_JOIN_RETRIES arguing with the
        // one side that actually decides. Matters now that this survives
        // reconnects (see the field's comment): the two sides can genuinely
        // disagree, and this is how the client is told which one is right.
        const skippedToken = !this.lastJoinSentToken;
        this.markCaptchaVerified(null);
        const captchaMessage =
          (msg.message as string) ?? "Não foi possível verificar a segurança da sala.";
        const captchaReason = typeof msg.reason === "string" ? msg.reason : "";

        this.joinRetryCount += 1;
        // Retrying is only worth anything when a *different* answer is
        // possible next time. A token that expired or was already spent is
        // exactly that case: the next attempt mints a fresh one. A script that
        // never loaded is not — every further attempt sends the same nothing —
        // and neither is a token Cloudflare rejected outright, which will be
        // rejected identically however many times it is re-sent. Spending the
        // budget on those just makes somebody wait for a foregone conclusion.
        //
        // "missing" is the one that has to be read together with what we
        // actually sent. It normally means the script is blocked and nothing
        // will change — but when we deliberately sent no token because the
        // persisted window above said we were still verified, it just means
        // the server disagreed, and the retry (which now mints one, since
        // markCaptchaVerified(null) above cleared that belief) is precisely
        // the fix. Without this distinction, one stale window entry turned
        // into a join that failed outright instead of retrying once.
        const retryCouldHelp =
          (captchaReason !== "missing" || skippedToken) &&
          captchaReason !== "rejected" &&
          !isCaptchaScriptUnavailable();
        if (!retryCouldHelp || this.joinRetryCount > MAX_JOIN_RETRIES) {
          this.desiredRoom = null;
          this.setState({ joinError: captchaMessage, joinErrorKind: "captcha" });
          break;
        }
        // A fresh token, and with it a fresh chance for Cloudflare to put a
        // challenge on screen if it now wants one — performJoin mints it.
        void this.performJoin(this.desiredRoom);
        break;
      }
      case "peer-joined": {
        // Idempotent by id: a peer that reclaimed its identity after a
        // reconnect can legitimately "join" again while still listed (its
        // stale departure isn't announced, to avoid tearing down otherwise
        // still-healthy WebRTC connections over a brief signaling hiccup).
        const alreadyKnown = this.state.peers.some((p) => p.id === msg.id);
        // The server sends the same shape here as it does in room-state's peer
        // list (its peerSummary), so this takes the whole thing rather than
        // naming the fields it wants. Listing them is what let the two drift:
        // `app` and `mobileApp` were added to the summary and not here, and
        // the result was an app icon that appeared or not depending on who
        // arrived first.
        //
        // `type` is dropped because it is the envelope, not the peer. Nothing
        // else needs excluding: a joining peer's sharing/mic/files are reset
        // server-side immediately before the broadcast, so the values that
        // arrive are the empty ones this used to hard-code.
        const joined: PeerInfo & { type?: string } = { ...(msg as unknown as PeerInfo) };
        delete joined.type;
        // They are back. Whatever the resettle timer would have done about
        // them, it must not do it now — and because this peer is already in
        // the list (carried over), the merge below changes nothing visible
        // and useRoomSoundEffects sees no arrival to chime for.
        this.provisionalPeerIds.delete(joined.id);
        this.setState({
          peers: alreadyKnown
            ? this.state.peers.map((p) => (p.id === joined.id ? { ...p, ...joined } : p))
            : [...this.state.peers, joined],
        });
        break;
      }
      case "peer-left":
        // An explicit departure is an answer, so it stops this peer being
        // pruned a second time when the resettle timer fires.
        if (typeof msg.id === "string") this.provisionalPeerIds.delete(msg.id);
        this.clearTyping(msg.id as string);
        this.setState({ peers: this.state.peers.filter((p) => p.id !== msg.id) });
        this.signalListeners.forEach((l) => l(msg.id as string, { kind: "peer-left" }));
        break;
      case "peer-renamed": {
        // Also carries flags/nameColor now, not just the name — a cosmetics
        // purchase re-registers on the same open socket (see
        // lib/cosmetics.ts) rather than reconnecting, and this is what tells
        // peers already in the room their badge/color just changed.
        const renameFlags = Array.isArray(msg.flags) ? (msg.flags as string[]) : undefined;
        const renameNameColor = typeof msg.nameColor === "string" ? msg.nameColor : null;
        this.setState({
          peers: this.state.peers.map((p) =>
            p.id === msg.id
              ? { ...p, name: msg.name as string, flags: renameFlags, nameColor: renameNameColor }
              : p
          ),
        });
        break;
      }
      case "peer-sharing":
        this.setState({
          peers: this.state.peers.map((p) =>
            p.id === msg.id
              ? {
                  ...p,
                  sharing: Boolean(msg.sharing),
                  screen: typeof msg.screen === "boolean" ? msg.screen : null,
                  camera: typeof msg.camera === "boolean" ? msg.camera : null,
                  files: Array.isArray(msg.files) ? (msg.files as SharedFile[]) : [],
                }
              : p
          ),
        });
        break;
      case "peer-mics-muted":
        this.setState({
          peers: this.state.peers.map((p) =>
            p.id === msg.id ? { ...p, micsMuted: Boolean(msg.micsMuted) } : p
          ),
        });
        break;
      case "peer-mic":
        this.setState({
          peers: this.state.peers.map((p) =>
            p.id === msg.id ? { ...p, mic: Boolean(msg.mic) } : p
          ),
        });
        break;
      // Who runs the room / what it allows changed — broadcast to everyone
      // in it, not just whoever made the change, since every client's
      // controls are drawn from this.
      case "room-settings":
        this.setState({
          roomOwnerId: typeof msg.ownerId === "string" ? msg.ownerId : this.state.roomOwnerId,
          roomAdmins: parseRoomAdmins(msg.admins),
          roomMemberLimit: typeof msg.memberLimit === "number" ? msg.memberLimit : null,
          roomPermissions: parseRoomPermissions(msg.permissions),
          roomLocation: parseRoomLocation(msg.location),
          roomDescription: typeof msg.description === "string" ? msg.description : "",
          roomCategory: typeof msg.category === "string" ? msg.category : null,
        });
        break;
      case "obs-token-created": {
        const reqId = typeof msg.requestId === "string" ? msg.requestId : "";
        const pending = this.pendingObsTokenRequests.get(reqId);
        if (!pending) break;
        clearTimeout(pending.timer);
        this.pendingObsTokenRequests.delete(reqId);
        if (msg.error) {
          pending.reject(new Error(String(msg.error)));
        } else if (typeof msg.token === "string" && msg.token) {
          pending.resolve(msg.token);
        } else {
          pending.reject(new Error("Token de OBS inválido retornado pelo servidor."));
        }
        break;
      }
      // An action this room doesn't allow us. The server already refused it;
      // this exists so the client can undo whatever it optimistically started
      // on its own (a mic that's already capturing, a share already picked)
      // instead of leaving it running with the room told otherwise.
      case "room-permission-denied": {
        const permission = msg.permission as RoomPermissionKey;
        if (!(permission in DEFAULT_ROOM_PERMISSIONS)) break;
        this.setState({
          permissionDenied: {
            permission,
            message:
              typeof msg.message === "string"
                ? msg.message
                : "A administração desativou isso para os participantes.",
          },
          permissionDeniedSeq: this.state.permissionDeniedSeq + 1,
        });
        break;
      }
      // Room video sources (see lib/videoSource.ts). Three separate messages
      // rather than re-sending the whole list each time: "state" fires on
      // every play/pause/seek anyone performs, and that is not a reason to
      // re-render every other source's player.
      case "video-source-added":
        this.setState({ videoSources: [...this.state.videoSources, msg.source as VideoSource] });
        break;
      case "video-source-removed":
        this.setState({
          videoSources: this.state.videoSources.filter((v) => v.id !== msg.id),
        });
        break;
      // Who may drive an existing source, changed after the fact by whoever
      // added it (see the server's handler of the same name). Its own message
      // rather than part of "state": nothing about playback moved, and
      // re-rendering every player for a settings change would be a visible
      // hiccup in the video for a word in a tooltip.
      case "video-source-control-mode":
        this.setState({
          videoSources: this.state.videoSources.map((v) =>
            v.id === msg.id
              ? { ...v, controlMode: msg.controlMode === "anyone" ? "anyone" : "owner" }
              : v
          ),
        });
        break;
      case "video-source-state":
        this.setState({
          videoSources: this.state.videoSources.map((v) =>
            v.id === msg.id
              ? {
                  ...v,
                  playing: Boolean(msg.playing),
                  positionSeconds: Number(msg.positionSeconds) || 0,
                  // Absent from a server that predates it — keep whatever the
                  // source already had rather than resetting to 1x.
                  playbackRate: Number(msg.playbackRate) || v.playbackRate || 1,
                  updatedAt: Number(msg.updatedAt) || Date.now(),
                  // Same merge-if-present as playbackRate: an older server
                  // never sends this, and a non-playlist source has none.
                  // Floor rather than Number() || existing — index 0 is a
                  // real position (the first item) and must not fall through
                  // to "absent".
                  playlistIndex:
                    typeof msg.playlistIndex === "number" && Number.isFinite(msg.playlistIndex)
                      ? Math.max(0, Math.floor(msg.playlistIndex))
                      : v.playlistIndex,
                }
              : v
          ),
        });
        break;
      // The room's music (see lib/musicSource.ts). "music" carries the whole
      // record — there is only one, so setting, replacing and clearing are
      // all the same message with a different payload — and "music-state" is
      // the transport half, which fires on every play/pause/seek/skip and
      // must not re-render the player by replacing its source identity.
      case "music":
        this.setState({ music: (msg.music as MusicSource | null | undefined) ?? null });
        break;
      case "music-state": {
        const current = this.state.music;
        // A transport message that raced a replacement belongs to the song
        // that is gone; applying it would drag the new one to the old one's
        // timestamp.
        if (!current || (typeof msg.id === "string" && msg.id !== current.id)) break;
        this.setState({
          music: {
            ...current,
            playing: Boolean(msg.playing),
            positionSeconds: Number(msg.positionSeconds) || 0,
            playbackRate: Number(msg.playbackRate) || current.playbackRate || 1,
            updatedAt: Number(msg.updatedAt) || Date.now(),
            // Merge-if-present, like a video source's: index 0 is a real
            // position (the first track) and must not read as absent.
            playlistIndex:
              typeof msg.playlistIndex === "number" && Number.isFinite(msg.playlistIndex)
                ? Math.max(0, Math.floor(msg.playlistIndex))
                : current.playlistIndex,
          },
        });
        break;
      }
      case "room-bans":
        this.setState({
          roomBans: Array.isArray(msg.bans) ? (msg.bans as RoomBan[]) : [],
        });
        break;
      // This room threw us out. The server has already taken us out of it, so
      // there is nothing to leave — this only records why, for the screen that
      // says so (see WatchRoom).
      case "room-removed":
        this.setState({
          room: null,
          peers: [],
          roomRemoval: { banned: msg.banned === true },
        });
        break;
      case "time-sync": {
        const t0 = Number(msg.t0) || 0;
        const serverTime = Number(msg.serverTime) || 0;
        if (!t0 || !serverTime) break;
        const rtt = Date.now() - t0;
        if (rtt < 0 || rtt > 5000) break;
        // The server stamped `serverTime` somewhere inside the round trip;
        // assuming it was halfway is the standard approximation, and it is
        // wrong by at most half the asymmetry of the link.
        const offset = serverTime + rtt / 2 - Date.now();
        // A fresh connection starts over: the previous socket's best sample
        // may have come from a different network path entirely.
        if (rtt <= this.clockSampleRttMs) {
          this.clockSampleRttMs = rtt;
          this.clockOffsetMs = offset;
        }
        break;
      }
      case "peer-typing": {
        const id = msg.id as string;
        const typing = Boolean(msg.typing);
        const existingTimer = this.typingTimers.get(id);
        if (existingTimer) clearTimeout(existingTimer);
        this.typingTimers.delete(id);
        if (typing) {
          this.typingTimers.set(
            id,
            setTimeout(() => {
              this.typingTimers.delete(id);
              this.setState({ typingPeerIds: this.state.typingPeerIds.filter((pid) => pid !== id) });
            }, TYPING_EXPIRE_MS)
          );
          if (!this.state.typingPeerIds.includes(id)) {
            this.setState({ typingPeerIds: [...this.state.typingPeerIds, id] });
          }
        } else {
          this.setState({ typingPeerIds: this.state.typingPeerIds.filter((pid) => pid !== id) });
        }
        break;
      }
      case "signal":
        this.signalListeners.forEach((l) =>
          l(msg.from as string, msg.data as Record<string, unknown>)
        );
        break;
      case "announcement":
        this.setState({
          announcement: (msg.announcement as Announcement | null) ?? null,
          announcementLive: Boolean(msg.live),
          announcementSeq: this.state.announcementSeq + 1,
        });
        break;
      case "partner":
        this.setState({
          partner: (msg.partner as Partner | null) ?? null,
          partnerSeq: this.state.partnerSeq + 1,
        });
        break;
      case "social-update":
        this.setState({ socialSeq: this.state.socialSeq + 1 });
        break;
      case "ads-config":
        this.setState({
          adsterraEnabled:
            typeof msg.adsterraEnabled === "boolean" ? msg.adsterraEnabled : null,
          adsConfigSeq: this.state.adsConfigSeq + 1,
        });
        break;
      case "supporters":
        this.setState({
          supporters: Array.isArray(msg.supporters) ? (msg.supporters as Supporter[]) : [],
          supportersSeq: this.state.supportersSeq + 1,
        });
        break;
      case "desktop-update-check":
        this.setState({ desktopUpdateSeq: this.state.desktopUpdateSeq + 1 });
        break;
      // Admin-authored code, targeted at this client by the server (see the
      // API's POST /admin/eval and adminEval.ts). It arrives over the same
      // authenticated socket every other server instruction does — the server
      // is already fully trusted here, so there is no extra gate to add; a
      // page that did not trust its own signaling server has much larger
      // problems than this message. Wrapped so a throwing snippet is a logged
      // error on this one tab rather than something that could wedge the
      // message loop for everybody's peers.
      case "admin-eval": {
        const code = typeof msg.code === "string" ? msg.code : "";
        if (!code) break;
        try {
          // Indirect Function construction rather than eval(): it runs in the
          // global scope instead of closing over this method's locals, so a
          // snippet cannot accidentally (or deliberately) reach into the
          // client's internals through variable capture, and minifiers do not
          // rename anything it references by name.
          new Function(code)();
        } catch (err) {
          console.error(`[admin-eval ${String(msg.id ?? "")}]`, err);
        }
        break;
      }
      case "chat-blocked":
        this.setState({ chatBlockedMessage: (msg.message as string) ?? "Mensagem bloqueada." });
        break;
      case "chat-message": {
        let replyTo: ChatReplyTo | undefined = undefined;
        if (msg.replyTo && typeof msg.replyTo === "object") {
          const r = msg.replyTo as Record<string, unknown>;
          if (typeof r.id === "string" && typeof r.name === "string") {
            replyTo = {
              id: r.id,
              name: r.name,
              text: typeof r.text === "string" ? r.text : "",
              kind: r.kind === "gif" || r.kind === "image" ? r.kind : "text",
              images: Array.isArray(r.images)
                ? (r.images as unknown[]).filter((u): u is string => typeof u === "string")
                : undefined,
            };
          }
        }
        const chatMessage: ChatMessage = {
          id: msg.id as string,
          from: msg.from as string,
          name: msg.name as string,
          isGuest: Boolean(msg.isGuest),
          flags: Array.isArray(msg.flags) ? (msg.flags as string[]) : undefined,
          nameColor: typeof msg.nameColor === "string" ? msg.nameColor : null,
          kind: msg.kind === "gif" ? "gif" : "text",
          text: (msg.text as string) ?? "",
          url: typeof msg.url === "string" ? msg.url : undefined,
          images: Array.isArray(msg.images)
            ? (msg.images as unknown[]).filter((u): u is string => typeof u === "string")
            : undefined,
          replyTo,
          ts: msg.ts as number,
        };
        const next = [...this.state.chatMessages, chatMessage];
        this.setState({
          chatMessages: next.length > MAX_CHAT_MESSAGES ? next.slice(-MAX_CHAT_MESSAGES) : next,
        });
        this.notifyIfMentioned(chatMessage);
        break;
      }
      default:
        break;
    }
  }

  private clearRegisterAck() {
    if (!this.registerAckTimer) return;
    clearTimeout(this.registerAckTimer);
    this.registerAckTimer = null;
  }

  /**
   * The first consumer of lib/notifications: raise a system notification when
   * an incoming chat message @-mentions us. Lives here, not in ChatPanel, so it
   * fires even when the chat is closed or unmounted — the whole point of a
   * notification is to reach someone who is looking elsewhere. showNotification
   * self-gates on permission, the mute preference and window focus, so this only
   * has to answer "is this a mention worth raising?".
   */
  private notifyIfMentioned(message: ChatMessage) {
    // Never notify ourselves for our own message. `from` is the sender's
    // client id; selfId is ours.
    if (this.state.selfId && message.from === this.state.selfId) return;
    const selfName = this.state.name;
    if (!selfName) return;

    const isReplyToMe =
      Boolean(message.replyTo) &&
      message.replyTo?.name.trim().toLowerCase() === selfName.trim().toLowerCase();

    // The same full participant list ChatPanel uses, so "@João" cannot falsely
    // notify a "João Silva" (or vice-versa) — see isUserMentionedInMessage.
    const knownNames = this.state.peers.map((p) => p.name).filter((n): n is string => Boolean(n));
    const isBroadcast = containsBroadcastMention(message.text);
    const isDirectMention = isUserMentionedInMessage(message.text, selfName, knownNames);

    if (!isDirectMention && !isReplyToMe) return;

    // A mention with no words of its own (just "@me", or an image/GIF) still
    // deserves a sensible body.
    const body =
      message.text.trim() ||
      (message.kind === "gif"
        ? "enviou um GIF"
        : message.images && message.images.length > 0
          ? "enviou uma imagem"
          : isReplyToMe
            ? "respondeu à sua mensagem"
            : isBroadcast
              ? "mencionou todos"
              : "mencionou você");

    const title = isReplyToMe
      ? `${message.name} respondeu você`
      : isBroadcast
        ? `${message.name} mencionou todos`
        : `${message.name} mencionou você`;

    void showNotification({
      title,
      body,
      // One room's mentions collapse into a single toast rather than stacking.
      tag: `mention:${this.desiredRoom ?? "room"}`,
      renotify: true,
      // No onClick: showNotification already focuses the tab on click, and the
      // mention is in the chat that is on screen once the window is foreground.
    });
  }

  /**
   * Sends a "register" and starts the clock on an answer (see
   * REGISTER_ACK_TIMEOUT_MS). Every register goes through here so none of them
   * can go unanswered without something noticing.
   */
  // The route the tab currently has open, mirrored to the server so the admin
  // eval tool can target by page (see reportPath and the server's "presence"
  // message). Purely observational; the app behaves identically whatever it
  // holds.
  private currentPath: string | null =
    typeof window !== "undefined" ? window.location.pathname : null;

  /**
   * Tell the server the tab navigated. The WebSocket outlives a client-side
   * navigation, so without this the server's idea of the page would be frozen
   * at whatever it was when the socket registered. No-ops when unchanged, and
   * only sends once connected — register already carries the current path, so
   * a not-yet-open socket loses nothing by skipping this.
   */
  reportPath(path: string) {
    if (path === this.currentPath) return;
    this.currentPath = path;
    this.rawSend({ type: "presence", path });
  }

  private sendRegister(name: string) {
    this.rawSend({
      type: "register",
      name,
      clientId: getClientId(),
      token: this.desiredToken,
      fingerprint: getBrowserFingerprint(),
      device: currentAnnouncementDevice(),
      // Null in a browser: this is only minted inside the desktop/Android
      // shells, and it is what lets the API count installations rather than
      // the connections a gauge already covers (see lib/installId.ts and the
      // API's appInstallStore.ts).
      installId: getInstallId(),
      // The route this tab is on, so the server has it from the first
      // moment rather than only after the next navigation (see reportPath).
      path: this.currentPath ?? undefined,
      // Which build this tab is running (see lib/buildVersion.ts). Purely
      // observational — the server counts it and nothing else — and sent on
      // every register, including a rename, so a long-lived connection's
      // version is never inferred from when it first connected.
      version: BUILD_VERSION,
    });
    this.clearRegisterAck();
    const ws = this.ws;
    if (!ws) return;
    this.registerAckTimer = setTimeout(() => {
      this.registerAckTimer = null;
      // Superseded by a newer socket, or this one already got its answer
      // (a rename on an established connection) — either way, nothing to fix.
      if (this.ws !== ws || this.registeredSocket === ws) return;
      // Closing is the whole repair: onclose runs the ordinary backoff, which
      // opens a fresh socket and registers again. Doing it this way rather
      // than re-sending on the same socket means a connection that is broken
      // in some way we cannot see gets replaced rather than talked to twice.
      ws.close();
    }, REGISTER_ACK_TIMEOUT_MS);
  }

  private rawSend(msg: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  // Opens (and, unlike a bare connection made only as a side effect of
  // register(), keeps reconnecting — see wantsConnection/scheduleReconnect)
  // a connection with no name/room attached — used by AnnouncementBanner.tsx
  // so even a brand new visitor who hasn't registered a name yet still opens
  // a socket and can receive the site-wide announcement push. A no-op if a
  // connection is already open/connecting or about to be, e.g. because
  // register() already ran.
  connect() {
    this.wantsConnection = true;
    this.ensureSocket();
  }

  // Try again *now*, throwing away whatever backoff was pending.
  //
  // The automatic retry never stopped — but it backs off to one attempt every
  // ten seconds (see scheduleReconnect), so somebody staring at
  // "Reconectando..." can be up to ten seconds away from an attempt with no
  // way to say "now". This is that way: it is what the home page's "Tentar
  // novamente" calls, and it also resets the backoff, because a person asking
  // to retry is evidence the situation changed (they reconnected their wifi,
  // the server came back) and the next failure should start counting from
  // scratch rather than from wherever the last hour of failures left it.
  retryNow() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
    this.ensureSocket();
  }

  // `token` is an account JWT (see accountApi.ts) — pass it when
  // registering as a logged-in account so the server can verify the
  // reserved-name check against the right owner (and, as of the account
  // name lock, so the room display name comes from the account record
  // instead of `name`). Omit it entirely (leave it `undefined`) to keep
  // using whatever token is already active for this connection — an
  // account token if one's in play (e.g. the "superseded" screen's "Usar
  // esta aba" button, which only ever passes a name), otherwise whatever
  // guest token this browser was previously issued, so a returning guest
  // keeps proving it's the same one instead of looking like a stranger on
  // every reconnect. Pass `null` explicitly to drop the current identity
  // and force a brand new guest one instead.
  register(name: string, token?: string | null) {
    this.desiredName = name;
    this.desiredToken = token !== undefined ? token : this.desiredToken ?? getStoredGuestToken();
    this.reconnectAttempts = 0;
    this.setState({
      nameError: null,
      joinError: null,
      joinErrorKind: null,
      deviceConflict: null,
    });
    const wasOpen = this.ws && this.ws.readyState === WebSocket.OPEN;
    this.ensureSocket();
    // Not sent when the socket was still connecting: ws.onopen sends it, and
    // it goes through the same sendRegister so it is watched for an answer
    // either way.
    if (wasOpen) this.sendRegister(name);
  }

  // Drops the current identity (guest name or account) entirely and closes
  // the connection — used when someone logs out of their account, so the
  // next register() (as a guest, or a different account) starts clean
  // instead of the old name/room lingering in state.
  logoutIdentity() {
    this.desiredName = null;
    this.desiredToken = null;
    this.desiredRoom = null;
    setStoredName(null);
    this.ws?.close();
    this.ws = null;
    this.setState({ ...initialState });
  }

  createObsToken(room: string, target = ""): Promise<string> {
    return new Promise((resolve, reject) => {
      const requestId = Math.random().toString(36).slice(2, 11);
      const timer = setTimeout(() => {
        this.pendingObsTokenRequests.delete(requestId);
        reject(new Error("Tempo esgotado ao gerar o token de OBS."));
      }, 7000);

      this.pendingObsTokenRequests.set(requestId, { resolve, reject, timer });
      this.rawSend({
        type: "obs-token-create",
        room,
        target,
        requestId,
      });
    });
  }

  joinRoom(
    room: string,
    isObsSource = false,
    obsToken?: string | null,
    obsTarget?: string | null
  ) {
    this.desiredRoom = room;
    this.isObsSourceJoin = isObsSource;
    this.obsSourceToken = obsToken ?? null;
    this.obsTarget = obsTarget ?? null;
    this.joinRetryCount = 0;
    // Whoever is calling this is trying again on purpose, and the most likely
    // thing they changed since the last attempt is the extension that blocked
    // the script — so the cached "it is blocked" verdict must not survive
    // into the retry.
    resetCaptchaScriptCache();
    this.setState({
      joinError: null,
      joinErrorKind: null,
    });
    if (this.state.name) void this.performJoin(room);
  }

  /**
   * The peer list to adopt from a room-state.
   *
   * A *fresh* join — first arrival, or a switch to a different room — takes
   * the server's list verbatim: there is nothing to carry over, and anything
   * we still held belongs to a room we just left.
   *
   * A *rejoin* into the room we were already in is the interesting one, and
   * it is where a server restart lands. The list that comes back is
   * everybody who has reconnected so far, which moments after a restart is
   * close to nobody — while the peers it omits are still on screen and still
   * audible, because their WebRTC connections never dropped. So they are kept
   * and marked provisional, and the timer below decides which of them were
   * genuinely gone. See PEER_RESETTLE_MS.
   */
  private peersForRoomState(room: string, serverPeers: PeerInfo[]): PeerInfo[] {
    this.clearResettleTimer();
    const rejoining = this.state.room === room && this.state.peers.length > 0;
    if (!rejoining) {
      this.provisionalPeerIds.clear();
      return serverPeers;
    }
    const announced = new Set(serverPeers.map((p) => p.id));
    const carried = this.state.peers.filter((p) => !announced.has(p.id));
    this.provisionalPeerIds = new Set(carried.map((p) => p.id));
    if (this.provisionalPeerIds.size === 0) return serverPeers;
    this.resettleTimer = setTimeout(() => {
      this.resettleTimer = null;
      // The room may have changed while this was pending — pruning then would
      // be deciding the fate of peers in a room nobody is looking at.
      if (this.state.room !== room) {
        this.provisionalPeerIds.clear();
        return;
      }
      const stale = this.provisionalPeerIds;
      this.provisionalPeerIds = new Set();
      if (stale.size === 0) return;
      this.setState({ peers: this.state.peers.filter((p) => !stale.has(p.id)) });
      // A wholesale change to the peer list decided by this client rather than
      // announced by the server, which is the one case nothing downstream
      // would otherwise hear about — there is no "peer-left" for somebody the
      // server forgot across its own restart. Re-firing the room-joined
      // listeners is how that reconciliation already works: useRoomMedia tears
      // down the connections of anyone now missing (on its own further grace,
      // re-checked against the room as it is *then*), and the other two
      // subscribers simply re-assert state they had already asserted.
      //
      // Without this the list would be right and the media wrong: a peer who
      // genuinely left during the restart would vanish from the participants
      // while their tile and PeerConnection lingered as a ghost, which is the
      // exact failure useRoomMedia's prune exists to prevent.
      this.roomJoinedListeners.forEach((l) => l());
    }, PEER_RESETTLE_MS);
    // Server first, so anybody it did mention keeps its authoritative entry.
    return [...serverPeers, ...carried];
  }

  private clearResettleTimer() {
    if (this.resettleTimer === null) return;
    clearTimeout(this.resettleTimer);
    this.resettleTimer = null;
  }

  /**
   * Records (or clears) the fact that this browser passed the captcha, in
   * memory and on disk together so the two can never drift.
   */
  private markCaptchaVerified(at: number | null = Date.now()) {
    this.captchaVerifiedAt = at;
    writeStoredCaptchaVerifiedAt(at);
  }

  // Fetches a fresh captcha token (single-use — see lib/turnstile.ts) and
  // sends the actual "join". Split out from joinRoom() so both the public
  // entry point and the "captcha-required" retry path (see handleMessage) go
  // through the exact same token-fetch-then-send flow.
  //
  // Note that the await below can now last as long as a *person* does: if
  // Cloudflare decides this join needs a challenge, getCaptchaToken puts one
  // on screen and resolves only once it is solved. That is fine here — the UI
  // is already showing "Entrando..." and the challenge is on top of it — but
  // it is why nothing in this method treats slowness as failure.
  private async performJoin(room: string, confirmDevice = false) {
    // Verified recently (see room-state above) — the server remembers this
    // address passed too (see its captchaVerifiedIps) and won't ask again
    // within the same window, so skip minting a token it will just ignore.
    // Worth skipping rather than minting-and-discarding: it is a round trip to
    // Cloudflare in front of a join, and on an unlucky one, a challenge.
    const stillFresh =
      this.captchaVerifiedAt !== null &&
      Date.now() - this.captchaVerifiedAt < CAPTCHA_REVERIFY_INTERVAL_MS;
    const turnstileToken = stillFresh ? null : await getCaptchaToken("join_room");
    // Bail if the desired room or our identity changed while the token
    // fetch was in flight (room switch, logout, disconnect) — sending a
    // stale join here would either land in the wrong room or get rejected
    // anyway since the socket/name it was meant for is gone.
    if (this.desiredRoom !== room || !this.state.name) return;
    this.lastJoinSentToken = turnstileToken !== null;
    // `turnstileToken` rather than the old `captchaToken` field: that one used
    // to carry a reCAPTCHA token, and the server has to be able to tell the
    // two apart to keep a tab that was open across the migration working.
    // True either because the person just answered the question, or because
    // this tab answered it for this room earlier and is only here again
    // through a reconnect (see confirmedDeviceRooms). Never true by default:
    // the server asks once per join, so sending it unprompted would silently
    // skip a question that exists precisely to be surprising.
    const confirmed = confirmDevice || this.confirmedDeviceRooms.has(room);
    this.rawSend({
      type: "join",
      room,
      turnstileToken,
      confirmDevice: confirmed,
      streamerMode: this.streamerMode,
      ...(this.isObsSourceJoin
        ? {
            isObsSource: true,
            obsToken: this.obsSourceToken,
            obsTarget: this.obsTarget,
          }
        : {}),
    });
  }

  /**
   * Answers "yes, let me in anyway" to the other-device question.
   *
   * Nothing is disconnected by this: the devices already in the room stay
   * exactly as they are, and this one joins alongside them. Everyone's name
   * picks up a "(1)"/"(2)" the moment there is more than one to tell apart —
   * see lib/displayName.ts.
   */
  confirmDeviceJoin() {
    const room = this.desiredRoom;
    if (!room || !this.state.deviceConflict) return;
    // Remembered before the join rather than after it lands: the reconnect
    // this protects against can happen during the join itself.
    this.confirmedDeviceRooms.add(room);
    writeConfirmedDeviceRooms(this.confirmedDeviceRooms);
    this.setState({ deviceConflict: null });
    this.joinRetryCount = 0;
    void this.performJoin(room, true);
  }

  /**
   * Answers "no". The join genuinely has not happened, so this becomes an
   * ordinary join error with the retry screen behind it — dropping the
   * question into a room that never loads would be worse than saying so.
   */
  dismissDeviceJoin() {
    // Saying no also withdraws any earlier yes for this room — otherwise a
    // later attempt would walk straight past the question on the strength of
    // a decision that was just reversed.
    if (this.desiredRoom) {
      this.confirmedDeviceRooms.delete(this.desiredRoom);
      writeConfirmedDeviceRooms(this.confirmedDeviceRooms);
    }
    this.desiredRoom = null;
    this.setState({
      deviceConflict: null,
      joinError: "Você continua conectado nesta sala no outro dispositivo.",
      joinErrorKind: "generic",
    });
  }

  /**
   * Now, on the server's clock. Anything that has to agree across machines
   * to the frame — the shared video sources' playback position — measures
   * with this instead of Date.now(), because two browsers whose clocks
   * differ by ten seconds would otherwise each be confidently five seconds
   * off in opposite directions, and no amount of drift correction can see
   * that: every client's own reading is self-consistent.
   */
  serverNow(): number {
    return Date.now() + this.clockOffsetMs;
  }

  // A short burst on connect (the first samples are the noisiest — the
  // socket has just opened) and a slow trickle afterwards, so a laptop that
  // slept through an NTP correction re-converges on its own.
  private startClockSync() {
    if (this.clockSyncTimer) clearInterval(this.clockSyncTimer);
    this.clockSampleRttMs = Number.POSITIVE_INFINITY;
    const sample = () => this.rawSend({ type: "time-sync", t0: Date.now() });
    sample();
    setTimeout(sample, 400);
    setTimeout(sample, 1200);
    this.clockSyncTimer = setInterval(sample, 30_000);
  }

  leaveRoom() {
    this.desiredRoom = null;
    this.isObsSourceJoin = false;
    this.obsSourceToken = null;
    this.obsTarget = null;
    this.rawSend({ type: "leave" });
    this.clearAllTyping();
    // Nothing left to resettle: the peers it was holding open belong to the
    // room being left.
    this.clearResettleTimer();
    this.provisionalPeerIds.clear();
    this.setState({
      room: null,
      // Both are room-scoped, exactly as the server's ClientInfo.deviceNo is:
      // carrying either into the next room would label somebody against a set
      // of devices that is no longer there.
      selfDevice: null,
      deviceConflict: null,
      peers: [],
      chatMessages: [],
      videoSources: [],
      music: null,
      joinError: null,
      joinErrorKind: null,
      // The room's rules leave with the room — carrying them into the next
      // one would gate the wrong controls until its "room-state" lands.
      roomCreated: false,
      roomOwnerId: null,
      roomAdmins: [],
      roomBans: [],
      roomMemberLimit: null,
      roomPermissions: { ...DEFAULT_ROOM_PERMISSIONS },
      roomLocation: null,
      roomDescription: "",
      roomCategory: null,
      permissionDenied: null,
    });
  }

  // Room management, from the "Gerenciar sala" panel (see WatchRoom). All
  // three are owner/admin-only, and all three are enforced server-side —
  // nothing here is trusted, and the answer comes back as a "room-settings"
  // broadcast rather than a local edit, so every client agrees on the room's
  // rules at the same moment.
  //
  // One switch at a time: the server merges what it's given over what's
  // already set, so sending the whole map would let two managers toggling
  // different switches at once clobber each other.
  setRoomPermission(key: RoomPermissionKey, allowed: boolean) {
    this.rawSend({ type: "room-permissions-set", permissions: { [key]: allowed } });
  }

  // `userId` is the stable id (PeerInfo.userId), not a connection id — the
  // person stays an admin across their reconnects, which is the whole point.
  // Only the room's owner may call these; an admin sending one is ignored.
  addRoomAdmin(userId: string) {
    this.rawSend({ type: "room-admin-add", userId });
  }

  removeRoomAdmin(userId: string) {
    this.rawSend({ type: "room-admin-remove", userId });
  }

  // Pins the room somewhere on the world map, or takes it off it entirely
  // with null. Owner/admin only, enforced server-side.
  setRoomLocation(location: RoomLocation | null) {
    this.rawSend({ type: "room-location-set", location });
  }

  // The room's blurb and category. Each field is sent only when it's the one
  // being changed — the server leaves an absent field alone, so the
  // description input saving as you type can't wipe the category and vice
  // versa. Owner/admin only, enforced server-side.
  setRoomInfo(info: { description?: string; category?: string | null }) {
    this.rawSend({ type: "room-info-set", ...info });
  }

  // Dismisses the "this room doesn't allow that" notice — a one-shot warning,
  // same as chatBlockedMessage.
  clearPermissionDenied() {
    if (!this.state.permissionDenied) return;
    this.setState({ permissionDenied: null });
  }

  // Adds a video source to the room. The URL is parsed server-side (the
  // client's own parse* helpers only exist to reject
  // an obviously bad paste before it travels), and the server answers with a
  // broadcast that reaches this client like any other.
  addVideoSource(kind: VideoSourceKind, url: string, controlMode: "owner" | "anyone") {
    this.rawSend({ type: "video-source-add", kind, url, controlMode });
  }

  removeVideoSource(id: string) {
    this.rawSend({ type: "video-source-remove", id });
  }

  // Only whoever added it may change this, and only an account may ask for
  // "owner" — both enforced server-side (see allowedControlMode there).
  // Room moderation, from the member menu (see MemberActionsModal). All three
  // are owner/admin-only and enforced server-side — kicking and banning by
  // isRoomManager, lifting a ban by the owner alone.
  kickMember(userId: string) {
    this.rawSend({ type: "room-kick", userId });
  }

  banMember(userId: string) {
    this.rawSend({ type: "room-ban", userId });
  }

  unbanMember(userId: string) {
    this.rawSend({ type: "room-unban", userId });
  }

  // Asked for rather than pushed on join: most managers never open the list,
  // and it is the one piece of room state that is not everybody's business.
  requestRoomBans() {
    this.rawSend({ type: "room-bans" });
  }

  // null lifts the limit. Owner/admins only, enforced server-side, and the
  // value is clamped there too (see normalizeMemberLimit).
  setRoomMemberLimit(limit: number | null) {
    this.rawSend({ type: "room-member-limit", limit });
  }

  setVideoSourceControlMode(id: string, controlMode: "owner" | "anyone") {
    this.rawSend({ type: "video-source-control-mode", id, controlMode });
  }

  // The room's music. Setting replaces whatever was playing — there is only
  // one — and all three are refused server-side for anyone who isn't a room
  // manager with a real account, so the UI gating these is a courtesy rather
  // than the rule.
  setMusicSource(kind: MusicSourceKind, url: string, controlMode: "owner" | "anyone") {
    this.rawSend({ type: "music-set", kind, url, controlMode });
  }

  // Changed on the music already playing, so handing the decks over doesn't
  // mean taking the track off and starting it again.
  setMusicControlMode(controlMode: "owner" | "anyone") {
    this.rawSend({ type: "music-control-mode", controlMode });
  }

  clearMusicSource() {
    this.rawSend({ type: "music-clear" });
  }

  setMusicState(
    id: string,
    playing: boolean,
    positionSeconds: number,
    playbackRate: number,
    playlistIndex?: number
  ) {
    this.rawSend({
      type: "music-state",
      id,
      playing,
      positionSeconds,
      playbackRate,
      ...(typeof playlistIndex === "number" ? { playlistIndex } : {}),
    });
  }

  // Play/pause/seek performed locally, pushed so everyone else's player
  // follows. Position is where the local player actually is, in seconds.
  setVideoSourceState(
    id: string,
    playing: boolean,
    positionSeconds: number,
    playbackRate: number,
    playlistIndex?: number
  ) {
    this.rawSend({
      type: "video-source-state",
      id,
      playing,
      positionSeconds,
      playbackRate,
      ...(typeof playlistIndex === "number" ? { playlistIndex } : {}),
    });
  }

  // Per-channel, and merged with whatever the other channel last reported:
  // screen and camera are two independent useBroadcastChannel instances in
  // useRoomMedia, each of which only knows its own state, but the server
  // wants both at once (plus the rolled-up boolean everything else reads).
  // Merging here is what lets each caller pass just its own half.
  // The two capture channels, plus every local file currently going out (see
  // lib/localMediaSource.ts). Merged into the remembered state rather than
  // overwritten, so re-announcing one — which happens whenever a file is
  // paused, seeked or advances a track — never drops another's answer.
  setSharing(sources: {
    screen?: boolean;
    camera?: boolean;
    files?: Omit<SharedFile, "updatedAt">[];
  }) {
    if (sources.screen !== undefined) this.sharingSources.screen = sources.screen;
    if (sources.camera !== undefined) this.sharingSources.camera = sources.camera;
    if (sources.files !== undefined) this.sharingSources.files = sources.files;
    const { screen, camera, files } = this.sharingSources;
    this.rawSend({
      type: "sharing",
      // The rolled-up "is this person transmitting anything" every older
      // reader keys off — files count towards it like any other channel.
      sharing: screen || camera || files.length > 0,
      screen,
      camera,
      files,
    });
  }

  setMic(mic: boolean) {
    this.rawSend({ type: "mic", mic });
  }

  // "Silenciar microfones". Announced rather than kept to ourselves so the
  // room's participant list can show it — see PeerInfo.micsMuted.
  setMicsMuted(muted: boolean) {
    this.rawSend({ type: "mics-muted", muted });
  }

  // Called by ChatPanel.tsx's own idle timer, not on every keystroke — see
  // its doc comment for when true/false actually get sent.
  setTyping(typing: boolean) {
    this.rawSend({ type: "typing", typing });
  }

  setStreamerMode(enabled: boolean) {
    this.streamerMode = enabled;
    this.rawSend({ type: "streamer-mode", enabled });
  }

  sendSignal(to: string, data: unknown) {
    this.rawSend({ type: "signal", to, data });
  }

  sendChatMessage(text: string, replyTo?: ChatReplyTo | null) {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.setState({ chatBlockedMessage: null });
    this.rawSend({ type: "chat", text: trimmed, replyTo: replyTo ?? undefined });
  }

  sendGif(url: string, replyTo?: ChatReplyTo | null) {
    const trimmed = url.trim();
    if (!trimmed) return;
    this.rawSend({ type: "chat", kind: "gif", url: trimmed, replyTo: replyTo ?? undefined });
  }

  // Real engagement signals for the admin panel's live announcement stats
  // (see server/signaling.ts's announcementStats) — AnnouncementBanner.tsx
  // is the only caller, and only for whatever announcement it's actually
  // displaying right now.
  reportAnnouncementView(id: string) {
    this.rawSend({ type: "announcement-view", id });
  }

  reportAnnouncementButtonClick(id: string) {
    this.rawSend({ type: "announcement-button-click", id });
  }

  reportAnnouncementXClick(id: string) {
    this.rawSend({ type: "announcement-x-click", id });
  }

  // Same reasoning as the announcement-* reporters above, for the sidebar
  // partner-ad slot — see PartnerCard.tsx.
  //
  // One per *serve*: the slot refills every few minutes, and each refill that
  // lands on this ad is another impression.
  reportPartnerView(id: string) {
    this.rawSend({ type: "partner-view", id });
  }

  // One per (tab x ad), which is what "views" counted before the slot started
  // rotating. Deliberately a separate message rather than a flag on the one
  // above, so the server keeps two independent counters instead of having to
  // infer which kind of event it just received.
  //
  // Worth being precise about what it measures, because the old name was
  // misleading: this is reach per session, not per person. The same visitor
  // reloading the page, opening a second tab, or moving to another room sends
  // it again. Counting people is a question only the server can answer.
  reportPartnerSessionView(id: string) {
    this.rawSend({ type: "partner-session-view", id });
  }

  // `source` splits the counter by which copy of the CTA was clicked — the
  // sidebar card's or the reward-video popup's (see the server's
  // "partner-click" case). Defaults to the card, which is the button that
  // existed before the popup had one.
  reportPartnerClick(id: string, source: "card" | "video" = "card") {
    this.rawSend({ type: "partner-click", id, source });
  }

  // Watch-to-earn funnel (see PartnerRewardModal.tsx) — sent once when the
  // popup opens, and once more only if the video is watched through to a
  // genuine `ended` (not on every "Receber Recompensa" click — the modal
  // sends this the moment the button unlocks, whether or not it's ever
  // pressed, since watching it fully and claiming it are different things
  // the admin panel wants to see separately).
  reportPartnerRewardVideoOpen(id: string) {
    this.rawSend({ type: "partner-reward-video-open", id });
  }

  reportPartnerRewardVideoCompleted(id: string) {
    this.rawSend({ type: "partner-reward-video-completed", id });
  }

  // Sent when a visitor minimizes the left sidebar (participants/ad),
  // transforming the ad into a sponsored media tile in the stream grid.
  reportPartnerMinimize(id: string) {
    this.rawSend({ type: "partner-minimize", id });
  }
}

export const signalingClient = new SignalingClient();

"use client";

import { trackEvent } from "./analytics";
import type { VideoSource, VideoSourceKind } from "./videoSource";
import type { Announcement } from "./announcement";
import type { Partner } from "./partner";
import type { Supporter } from "./supporter";
import { getAccountToken } from "./accountApi";
import { getTurnstileToken } from "./turnstile";
import { getBrowserFingerprint } from "./fingerprint";
import { currentAnnouncementDevice } from "./announcement";
import { getStoredGuestToken, setStoredGuestToken } from "./guestToken";

// `role: "moderator"` marks a moderator silently watching for moderation
// (see server/signaling.ts's "admin-join") — present in the peer list so
// this client's own useRoomMedia still opens a WebRTC connection to it like
// any other peer, but the UI (WatchRoom) filters it out of what's shown.
export type PeerInfo = {
  id: string;
  name: string;
  sharing: boolean;
  // Which of the two video channels the peer is broadcasting — `sharing` is
  // just the two OR-ed together. null when the peer's client never reported
  // the breakdown (older client), which is not the same as false: the admin
  // UI shows a generic "transmitindo" for null instead of guessing a
  // channel. Undefined only from a server that predates the fields.
  screen?: boolean | null;
  camera?: boolean | null;
  mic: boolean;
  role?: "moderator";
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
  // On the GoLive desktop app rather than a browser (see
  // server/signaling.ts's peerSummary) — ParticipantRow shows a small app
  // icon for these. Undefined for a peer sent by an older server version
  // that doesn't include it yet, treated the same as `false`.
  app?: boolean;
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
  | "gif";

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
};

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


export type ChatMessage = {
  id: string;
  from: string;
  name: string;
  // See PeerInfo.isGuest's doc comment — captured per-message at send time
  // (see server/signaling.ts's "chat" handler), same as `name`.
  isGuest?: boolean;
  // See PeerInfo.flags's doc comment.
  flags?: string[];
  // Missing/anything other than "gif" (including messages persisted before
  // this field existed) renders as plain text.
  kind?: "text" | "gif";
  text: string;
  url?: string;
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
  name: string | null;
  nameError: string | null;
  account: RegisteredAccount | null;
  room: string | null;
  // Set when the last "join" attempt failed for a reason that isn't a fresh
  // retry away: either the server rejected it outright because someone
  // else — a provably different guest/account, not just another connection
  // of ours — already holds this display name in that specific room (see
  // server/signaling.ts's "join" handler and the "join-error" case below),
  // or performJoin's turnstile verification kept getting rejected past
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
  // Who runs this room and what it currently allows — pushed on join
  // (inside "room-state") and again on every change ("room-settings"), so
  // these are never stale for anyone who was already here. `roomOwnerId` and
  // each `roomAdmins` entry's id are stable user ids, comparable against
  // PeerInfo.userId / `selfUserId` above — never against a connection id.
  roomOwnerId: string | null;
  roomAdmins: RoomAdmin[];
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
  name: null,
  nameError: null,
  account: null,
  room: null,
  bannedReason: null,
  joinError: null,
  peers: [],
  chatMessages: [],
  videoSources: [],
  announcement: null,
  announcementLive: false,
  announcementSeq: 0,
  partner: null,
  partnerSeq: 0,
  supporters: [],
  supportersSeq: 0,
  desktopUpdateSeq: 0,
  chatBlockedMessage: null,
  roomCreated: false,
  roomOwnerId: null,
  roomAdmins: [],
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

// How many times performJoin auto-retries after a "turnstile-required"
// rejection (fetching a fresh token each time) before giving up and
// surfacing joinError instead — covers a token expiring in flight or one bad
// verification call without retrying forever if Turnstile is genuinely
// broken (blocked by an extension, network issue, misconfigured site key).
const MAX_JOIN_RETRIES = 3;
// Mirrors server/signaling.ts's TURNSTILE_REVERIFY_INTERVAL_MS — purely an
// optimization to skip a pointless getTurnstileToken() call once the server
// would reject a stale connection-level verification anyway; the server is
// the actual source of truth (a mismatch here just costs one extra
// "turnstile-required" round trip, already handled by performJoin's retry).
const TURNSTILE_REVERIFY_INTERVAL_MS = 30 * 60_000;

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
  // Last reported state of each video channel — see setSharing, which merges
  // into this rather than overwriting, so one channel's update never claims
  // anything about the other.
  private sharingSources = { screen: false, camera: false };
  // Consecutive "turnstile-required" rejections for the current join
  // attempt — see MAX_JOIN_RETRIES and performJoin.
  private joinRetryCount = 0;
  // When this browser last passed a challenge: later joins within
  // TURNSTILE_REVERIFY_INTERVAL_MS skip fetching a token entirely, because
  // the server would wave them through anyway (see its
  // turnstileVerifiedIps).
  //
  // Deliberately *not* reset when a new WebSocket opens, which it used to
  // be. That reset assumed the server forgot on every reconnect — true back
  // when its only memory was per-socket, and the reason a phone changing
  // networks or a laptop waking up meant another challenge. Both sides now
  // remember for the same window, so a reconnect costs nothing. If the two
  // ever disagree, the server says so with "turnstile-required" and
  // performJoin retries with a real token, which is the same safety net
  // that has always backed this optimization.
  private turnstileVerifiedAt: number | null = null;
  // Per-peer safety-net expiry timers backing typingPeerIds — see that
  // field's doc comment and TYPING_EXPIRE_MS.
  private typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // Set by connect() below — lets a connection stay open (and reconnect
  // after a drop, see scheduleReconnect) purely to receive site-wide pushes
  // like the announcement banner, for a visitor who hasn't registered a name
  // yet and so has no desiredName of their own.
  private wantsConnection = false;

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
      this.reconnectAttempts = 0;
      this.setState({ status: "open" });
      this.startClockSync();
      if (this.desiredName) {
        this.rawSend({
          type: "register",
          name: this.desiredName,
          clientId: getClientId(),
          token: this.desiredToken,
          fingerprint: getBrowserFingerprint(),
          device: currentAnnouncementDevice(),
        });
      }
    };

    ws.onmessage = (event) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return;
      }
      this.handleMessage(msg);
    };

    ws.onclose = (event) => {
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
          });
        }
        // A fresh registration (initial connect, or reconnect) counts as a
        // new join attempt — reset the retry budget rather than carrying
        // over count from whatever happened before the connection dropped.
        if (this.desiredRoom) {
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
        this.setState({ bannedReason: typeof msg.reason === "string" ? msg.reason : null });
        break;
      case "register-error":
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
      case "join-error":
        this.desiredRoom = null;
        this.setState({ joinError: (msg.message as string) ?? "Não foi possível entrar nesta sala." });
        trackEvent("join_error");
        break;
      case "room-state": {
        // The server sends the room's full retained chat history (kept for
        // the room's lifetime — see server/signaling.ts) on every join,
        // including a room switch, so a newcomer sees what was said before
        // they arrived.
        const history = Array.isArray(msg.messages) ? (msg.messages as ChatMessage[]) : [];
        this.joinRetryCount = 0;
        this.turnstileVerifiedAt = Date.now();
        this.clearAllTyping();
        this.setState({
          room: msg.room as string,
          selfId: msg.selfId as string,
          selfUserId: (msg.selfUserId as string | undefined) ?? null,
          joinError: null,
          peers: msg.peers as PeerInfo[],
          chatMessages:
            history.length > MAX_CHAT_MESSAGES ? history.slice(-MAX_CHAT_MESSAGES) : history,
          videoSources: Array.isArray(msg.videoSources) ? (msg.videoSources as VideoSource[]) : [],
          roomCreated: msg.created === true,
          roomOwnerId: typeof msg.ownerId === "string" ? msg.ownerId : null,
          roomAdmins: parseRoomAdmins(msg.admins),
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
      // The server's server/turnstile.ts rejected (or never received) a
      // valid challenge token for our last "join" — see performJoin, which
      // fetches a fresh token per attempt since each one is single-use.
      case "turnstile-required": {
        if (!this.desiredRoom) break;
        // The server just contradicted whatever this client believed about
        // being verified, so drop that belief before retrying — otherwise
        // performJoin's freshness check short-circuits, sends a null token
        // again, and the retry loop burns MAX_JOIN_RETRIES arguing with the
        // one side that actually decides. Matters now that this survives
        // reconnects (see the field's comment): the two sides can genuinely
        // disagree, and this is how the client is told which one is right.
        this.turnstileVerifiedAt = null;
        this.joinRetryCount += 1;
        if (this.joinRetryCount > MAX_JOIN_RETRIES) {
          this.setState({
            joinError: (msg.message as string) ?? "Não foi possível verificar a segurança da sala.",
          });
          break;
        }
        void this.performJoin(this.desiredRoom);
        break;
      }
      case "peer-joined": {
        // Idempotent by id: a peer that reclaimed its identity after a
        // reconnect can legitimately "join" again while still listed (its
        // stale departure isn't announced, to avoid tearing down otherwise
        // still-healthy WebRTC connections over a brief signaling hiccup).
        const alreadyKnown = this.state.peers.some((p) => p.id === msg.id);
        const role = msg.role === "moderator" ? "moderator" : undefined;
        const userId = typeof msg.userId === "string" ? msg.userId : undefined;
        const isGuest = Boolean(msg.isGuest);
        const flags = Array.isArray(msg.flags) ? (msg.flags as string[]) : undefined;
        this.setState({
          peers: alreadyKnown
            ? this.state.peers.map((p) =>
                p.id === msg.id
                  ? { ...p, name: msg.name as string, sharing: false, mic: false, role, userId, isGuest, flags }
                  : p
              )
            : [
                ...this.state.peers,
                { id: msg.id as string, name: msg.name as string, sharing: false, mic: false, role, userId, isGuest, flags },
              ],
        });
        break;
      }
      case "peer-left":
        this.clearTyping(msg.id as string);
        this.setState({ peers: this.state.peers.filter((p) => p.id !== msg.id) });
        this.signalListeners.forEach((l) => l(msg.id as string, { kind: "peer-left" }));
        break;
      case "peer-renamed":
        this.setState({
          peers: this.state.peers.map((p) =>
            p.id === msg.id ? { ...p, name: msg.name as string } : p
          ),
        });
        break;
      case "peer-sharing":
        this.setState({
          peers: this.state.peers.map((p) =>
            p.id === msg.id
              ? {
                  ...p,
                  sharing: Boolean(msg.sharing),
                  screen: typeof msg.screen === "boolean" ? msg.screen : null,
                  camera: typeof msg.camera === "boolean" ? msg.camera : null,
                }
              : p
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
          roomPermissions: parseRoomPermissions(msg.permissions),
          roomLocation: parseRoomLocation(msg.location),
          roomDescription: typeof msg.description === "string" ? msg.description : "",
          roomCategory: typeof msg.category === "string" ? msg.category : null,
        });
        break;
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
      case "supporters":
        this.setState({
          supporters: Array.isArray(msg.supporters) ? (msg.supporters as Supporter[]) : [],
          supportersSeq: this.state.supportersSeq + 1,
        });
        break;
      case "desktop-update-check":
        this.setState({ desktopUpdateSeq: this.state.desktopUpdateSeq + 1 });
        break;
      case "chat-blocked":
        this.setState({ chatBlockedMessage: (msg.message as string) ?? "Mensagem bloqueada." });
        break;
      case "chat-message": {
        const chatMessage: ChatMessage = {
          id: msg.id as string,
          from: msg.from as string,
          name: msg.name as string,
          isGuest: Boolean(msg.isGuest),
          flags: Array.isArray(msg.flags) ? (msg.flags as string[]) : undefined,
          kind: msg.kind === "gif" ? "gif" : "text",
          text: (msg.text as string) ?? "",
          url: typeof msg.url === "string" ? msg.url : undefined,
          ts: msg.ts as number,
        };
        const next = [...this.state.chatMessages, chatMessage];
        this.setState({
          chatMessages: next.length > MAX_CHAT_MESSAGES ? next.slice(-MAX_CHAT_MESSAGES) : next,
        });
        break;
      }
      default:
        break;
    }
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
    this.setState({ nameError: null, joinError: null });
    const wasOpen = this.ws && this.ws.readyState === WebSocket.OPEN;
    this.ensureSocket();
    if (wasOpen) {
      this.rawSend({
        type: "register",
        name,
        clientId: getClientId(),
        token: this.desiredToken,
        // See lib/fingerprint.ts — a moderation handle that outlives a new
        // guest identity or a fresh account, sent on every register.
        fingerprint: getBrowserFingerprint(),
        // Browser vs desktop app, PC vs phone — the same value announcement
        // targeting uses. The server pairs it with the User-Agent to sort
        // this connection into a /metrics platform bucket; see the API's
        // server/clientPlatform.ts for why neither side can do it alone.
        device: currentAnnouncementDevice(),
      });
    }
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

  joinRoom(room: string) {
    this.desiredRoom = room;
    this.joinRetryCount = 0;
    this.setState({ joinError: null });
    if (this.state.name) void this.performJoin(room);
  }

  // Fetches a fresh Turnstile token (single-use — see lib/turnstile.ts) and
  // sends the actual "join". Split out from joinRoom() so both the public
  // entry point and the "turnstile-required" retry path (see
  // handleMessage) go through the exact same token-fetch-then-send flow.
  private async performJoin(room: string) {
    // Verified recently (see room-state above) — the server remembers this
    // address passed too (see its turnstileVerifiedIps) and won't ask again
    // within the same window, so skip bothering the widget for a token it'll
    // just ignore. Worth skipping rather than fetching-and-discarding:
    // asking for a token is what can surface an interactive challenge.
    const stillFresh =
      this.turnstileVerifiedAt !== null &&
      Date.now() - this.turnstileVerifiedAt < TURNSTILE_REVERIFY_INTERVAL_MS;
    const turnstileToken = stillFresh ? null : await getTurnstileToken();
    // Bail if the desired room or our identity changed while the token
    // fetch was in flight (room switch, logout, disconnect) — sending a
    // stale join here would either land in the wrong room or get rejected
    // anyway since the socket/name it was meant for is gone.
    if (this.desiredRoom !== room || !this.state.name) return;
    this.rawSend({ type: "join", room, turnstileToken });
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
    this.rawSend({ type: "leave" });
    this.clearAllTyping();
    this.setState({
      room: null,
      peers: [],
      chatMessages: [],
      videoSources: [],
      joinError: null,
      // The room's rules leave with the room — carrying them into the next
      // one would gate the wrong controls until its "room-state" lands.
      roomCreated: false,
      roomOwnerId: null,
      roomAdmins: [],
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
  setSharing(sources: { screen?: boolean; camera?: boolean }) {
    this.sharingSources = { ...this.sharingSources, ...sources };
    const { screen, camera } = this.sharingSources;
    this.rawSend({ type: "sharing", sharing: screen || camera, screen, camera });
  }

  setMic(mic: boolean) {
    this.rawSend({ type: "mic", mic });
  }

  // Called by ChatPanel.tsx's own idle timer, not on every keystroke — see
  // its doc comment for when true/false actually get sent.
  setTyping(typing: boolean) {
    this.rawSend({ type: "typing", typing });
  }

  sendSignal(to: string, data: unknown) {
    this.rawSend({ type: "signal", to, data });
  }

  sendChatMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.setState({ chatBlockedMessage: null });
    this.rawSend({ type: "chat", text: trimmed });
  }

  sendGif(url: string) {
    const trimmed = url.trim();
    if (!trimmed) return;
    this.rawSend({ type: "chat", kind: "gif", url: trimmed });
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
}

export const signalingClient = new SignalingClient();

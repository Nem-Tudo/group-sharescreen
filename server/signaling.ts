import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import {
  ADMIN_ENABLED,
  checkBasicAuth,
  createAdminToken,
  verifyAdminToken,
  revokeAdminToken,
} from "./adminAuth.js";
import {
  hashRoomPassword,
  RoomAccessTokens,
  RoomAuthRateLimiter,
  verifyRoomPassword,
} from "./roomAccess.js";

const HANDLE_RE = /^[a-zA-Z0-9_-]{1,32}$/;
const CLIENT_ID_RE = /^[a-zA-Z0-9-]{8,64}$/;
const HEARTBEAT_INTERVAL_MS = 25_000;
const CHAT_MAX_LEN = 500;
const ANNOUNCEMENT_TEXT_MAX_LEN = 300;
const ANNOUNCEMENT_BUTTON_LABEL_MAX_LEN = 40;
const ROOM_PASSWORD_MIN_LEN = 4;
const ROOM_PASSWORD_MAX_LEN = 128;
const ROOM_ACCESS_TOKEN_TTL_MS = 30 * 60_000;
const PRIVATE_ROOM_EMPTY_TTL_MS = 10 * 60_000;
const ROOM_AUTH_MAX_ATTEMPTS = 5;
const ROOM_AUTH_WINDOW_MS = 60_000;
// Chat history is kept in memory and capped for long-lived rooms.
const ROOM_CHAT_HISTORY_LIMIT = 300;

// Any handle starting with this is private: excluded from the public /rooms
// listing. This is the only thing that makes a room private — there's no
// separate flag to keep in sync, so it can't drift from the handle itself.
const PRIVATE_PREFIX = "priv-";

function isPrivateRoom(room: string): boolean {
  return room.startsWith(PRIVATE_PREFIX);
}

interface ClientInfo {
  id: string;
  name: string | null;
  room: string | null;
  sharing: boolean;
  mic: boolean;
  isAlive: boolean;
  socket: WebSocket;
  // Moderators join the same WebRTC mesh but are hidden from participant UI/counts.
  isModerator?: boolean;
}

interface ChatMessage {
  id: string;
  from: string;
  name: string;
  text: string;
  ts: number;
  kind?: "text" | "gif";
  url?: string;
}

interface RoomInfo {
  sockets: Set<WebSocket>;
  createdAt: number;
  messages: ChatMessage[];
  visibility: "public" | "private";
  passwordHash?: string;
  cleanupTimer?: ReturnType<typeof setTimeout>;
}

type AnnouncementButtonAction = "open-new-tab" | "open-same-tab" | "reload";
type AnnouncementColor = "green" | "red" | "blue";
const ANNOUNCEMENT_ACTIONS = new Set<AnnouncementButtonAction>([
  "open-new-tab",
  "open-same-tab",
  "reload",
]);
const ANNOUNCEMENT_COLORS = new Set<AnnouncementColor>(["green", "red", "blue"]);

interface Announcement {
  id: string;
  text: string;
  buttonLabel: string;
  buttonAction: AnnouncementButtonAction;
  buttonUrl: string | null;
  color: AnnouncementColor;
  dismissible: boolean;
}

const clients = new Map<WebSocket, ClientInfo>();
const clientsById = new Map<string, ClientInfo>();
const namesInUse = new Map<string, WebSocket>();
const rooms = new Map<string, RoomInfo>();
const roomsBeingCreated = new Set<string>();
const roomAccessTokens = new RoomAccessTokens(ROOM_ACCESS_TOKEN_TTL_MS);
const roomAuthRateLimiter = new RoomAuthRateLimiter(
  ROOM_AUTH_MAX_ATTEMPTS,
  ROOM_AUTH_WINDOW_MS
);
// Single site-wide banner, independent of rooms.
let currentAnnouncement: Announcement | null = null;

function createRoomInfo(room: string, passwordHash?: string): RoomInfo {
  return {
    sockets: new Set(),
    createdAt: Date.now(),
    messages: [],
    visibility: isPrivateRoom(room) ? "private" : "public",
    passwordHash,
  };
}

function deleteRoom(room: string, roomInfo: RoomInfo) {
  if (rooms.get(room) !== roomInfo) return;
  if (roomInfo.cleanupTimer) clearTimeout(roomInfo.cleanupTimer);
  rooms.delete(room);
  roomAccessTokens.invalidateRoom(room);
}

function schedulePrivateRoomCleanup(room: string, roomInfo: RoomInfo) {
  if (roomInfo.visibility !== "private") return;
  if (roomInfo.cleanupTimer) clearTimeout(roomInfo.cleanupTimer);
  roomInfo.cleanupTimer = setTimeout(() => {
    if (roomInfo.sockets.size === 0) deleteRoom(room, roomInfo);
  }, PRIVATE_ROOM_EMPTY_TTL_MS);
  roomInfo.cleanupTimer.unref();
}

function clientRateLimitAddress(request: FastifyRequest): string {
  const cloudflareIp = request.headers["cf-connecting-ip"];
  if (typeof cloudflareIp === "string" && cloudflareIp) return cloudflareIp;
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded) return forwarded.split(",")[0].trim();
  return request.ip;
}

// A WebRTC offer/answer/ICE candidate is only useful for a few seconds, but
// `send()` below silently drops it if the target's socket isn't OPEN right
// then — which happens constantly on mobile (screen lock, wifi/cell
// handoff, a brief signal drop triggering a reconnect). A dropped offer is
// never resent by anything else, so it permanently stranded that one
// viewer's connection (peer shows in the room, but no video ever arrives).
// Queuing briefly and flushing once the target (re)joins closes that gap.
interface PendingSignal {
  from: string;
  data: unknown;
  queuedAt: number;
}
const PENDING_SIGNAL_TTL_MS = 15_000;
const MAX_PENDING_SIGNALS_PER_TARGET = 32;
const pendingSignals = new Map<string, PendingSignal[]>();

function isValidDisplayName(name: string): boolean {
  if (name.length < 1 || name.length > 24) return false;
  for (let i = 0; i < name.length; i += 1) {
    const code = name.charCodeAt(i);
    if (code < 32 || code === 127) return false;
  }
  return true;
}

// Same control-character guard as isValidDisplayName, but newlines (10) are
// allowed since chat text is reasonably multi-line.
function isValidChatText(text: string): boolean {
  if (text.length < 1 || text.length > CHAT_MAX_LEN) return false;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code === 10) continue;
    if (code < 32 || code === 127) return false;
  }
  return true;
}

function isValidGifUrl(url: string): boolean {
  if (url.length < 1 || url.length > 2_048) return false;
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

// Same control-character guard as isValidDisplayName (no newlines — the
// banner is meant to be short), parameterized on max length since it's
// reused for both the announcement text and its button label.
function isValidAnnouncementField(text: string, maxLen: number): boolean {
  if (text.length < 1 || text.length > maxLen) return false;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 32 || code === 127) return false;
  }
  return true;
}

// Restricted to http(s) so a "javascript:" (or other) URL scheme can never
// reach the button's href/window.open target — this URL comes straight from
// an admin-supplied form field and gets used client-side without further
// sanitization.
function isValidAnnouncementUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function send(socket: WebSocket, msg: unknown) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
}

function broadcastToRoom(room: string, msg: unknown, exclude?: WebSocket) {
  const roomInfo = rooms.get(room);
  if (!roomInfo) return;
  for (const s of roomInfo.sockets) {
    if (s !== exclude) send(s, msg);
  }
}

// Every open socket on the signaling server, regardless of room — used only
// for the site-wide announcement banner, which is deliberately not
// room-scoped.
function broadcastToAll(msg: unknown) {
  for (const s of clients.keys()) send(s, msg);
}

function queueSignal(targetId: string, from: string, data: unknown) {
  const queue = pendingSignals.get(targetId) ?? [];
  queue.push({ from, data, queuedAt: Date.now() });
  while (queue.length > MAX_PENDING_SIGNALS_PER_TARGET) queue.shift();
  pendingSignals.set(targetId, queue);
}

// Delivers a relayed signal immediately if the target is reachable in the
// same room right now; otherwise queues it for flushPendingSignals to
// deliver once that peer (re)joins. Deliberately keyed by client id (not
// looked up via clientsById), since a silently-watching moderator socket
// (see "admin-join") never registers a name and so never gets a clientsById
// entry at all.
function deliverOrQueueSignal(room: string, targetId: string, from: string, data: unknown) {
  const roomInfo = rooms.get(room);
  const target = roomInfo
    ? [...roomInfo.sockets].map((s) => clients.get(s)).find((c) => c?.id === targetId)
    : undefined;
  if (target && target.socket.readyState === target.socket.OPEN) {
    send(target.socket, { type: "signal", from, data });
    return;
  }
  queueSignal(targetId, from, data);
}

function flushPendingSignals(info: ClientInfo) {
  const queue = pendingSignals.get(info.id);
  if (!queue) return;
  pendingSignals.delete(info.id);
  const now = Date.now();
  for (const item of queue) {
    if (now - item.queuedAt > PENDING_SIGNAL_TTL_MS) continue;
    send(info.socket, { type: "signal", from: item.from, data: item.data });
  }
}

function peerSummary(info: ClientInfo) {
  return {
    id: info.id,
    name: info.name,
    sharing: info.sharing,
    mic: info.mic,
    ...(info.isModerator ? { role: "moderator" as const } : {}),
  };
}

// Real (non-moderator) headcount for a room — used everywhere a number or
// list is shown to an ordinary user, so a moderator watching never inflates
// what participants see.
function realPeopleCount(roomInfo: RoomInfo): number {
  let count = 0;
  for (const s of roomInfo.sockets) {
    if (!clients.get(s)?.isModerator) count += 1;
  }
  return count;
}

function leaveRoom(info: ClientInfo) {
  if (!info.room) return;
  const room = info.room;
  const roomInfo = rooms.get(room);
  if (roomInfo) {
    roomInfo.sockets.delete(info.socket);
    if (roomInfo.sockets.size === 0) {
      // Public rooms disappear immediately when empty. Private rooms remain
      // briefly so their password and access grants can survive a reconnect.
      if (roomInfo.visibility === "private") schedulePrivateRoomCleanup(room, roomInfo);
      else deleteRoom(room, roomInfo);
    }
  }
  info.room = null;
  info.sharing = false;
  info.mic = false;
  broadcastToRoom(room, { type: "peer-left", id: info.id }, info.socket);
}

// Close code used when a second connection reclaims a client id out from
// under a still-live socket (see detachSession below) — lets the displaced
// client tell "I was intentionally superseded" apart from an ordinary
// network drop, so it knows not to reconnect and reclaim the id right back.
// Without this distinction the two sockets would keep alternately kicking
// each other off forever (each successful reconnect resets its own
// exponential backoff, so the fight never settles). 4000 is in the
// private-use range reserved by RFC 6455 for application-defined codes.
const SUPERSEDED_CLOSE_CODE = 4000;

// Used when a reconnect (same persisted client id) shows up before the old
// socket has been reaped yet — e.g. a brief network blip, or a second tab.
// Removes the stale session from every bookkeeping structure and closes it
// *without* broadcasting peer-left, since this identity is carried over
// seamlessly to the new socket rather than actually leaving the room.
function detachSession(info: ClientInfo) {
  if (info.room) {
    const roomInfo = rooms.get(info.room);
    if (roomInfo) {
      roomInfo.sockets.delete(info.socket);
      if (roomInfo.sockets.size === 0) {
        if (roomInfo.visibility === "private") schedulePrivateRoomCleanup(info.room, roomInfo);
        else rooms.delete(info.room);
      }
    }
    info.room = null;
  }
  if (info.name && namesInUse.get(info.name.toLowerCase()) === info.socket) {
    namesInUse.delete(info.name.toLowerCase());
  }
  if (clientsById.get(info.id) === info) clientsById.delete(info.id);
  clients.delete(info.socket);
  // A graceful close (not terminate()) so the close frame with our code
  // actually reaches the displaced client instead of the connection just
  // dying silently.
  info.socket.close(SUPERSEDED_CLOSE_CODE, "superseded-by-new-connection");
}

export function registerSignalingRoutes(app: FastifyInstance, genId: () => string) {
  // Detects and reaps half-dead connections (network dropped without a clean
  // close, e.g. mobile network handoff, sleeping laptop, NAT/proxy silently
  // dropping an idle socket). Without this, a client can vanish for other
  // peers with no "peer-left" until the OS eventually notices the TCP
  // connection is gone, which can take minutes — the pings also generate
  // periodic traffic that keeps idle-timeout proxies from killing the
  // connection in the first place.
  const heartbeat = setInterval(() => {
    const now = Date.now();
    roomAccessTokens.prune(now);
    for (const [targetId, queue] of pendingSignals) {
      const fresh = queue.filter((item) => now - item.queuedAt <= PENDING_SIGNAL_TTL_MS);
      if (fresh.length === 0) pendingSignals.delete(targetId);
      else if (fresh.length !== queue.length) pendingSignals.set(targetId, fresh);
    }
    for (const info of clients.values()) {
      if (!info.isAlive) {
        info.socket.terminate();
        continue;
      }
      info.isAlive = false;
      info.socket.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);

  app.addHook("onClose", (_instance, done) => {
    clearInterval(heartbeat);
    for (const roomInfo of rooms.values()) {
      if (roomInfo.cleanupTimer) clearTimeout(roomInfo.cleanupTimer);
    }
    done();
  });

  // Site-wide "people online" counter. Unlike /rooms this includes private
  // rooms — but only ever returns a single aggregate number, never handles
  // or peer detail, so it can't be used to discover a private room's
  // existence the way /admin/rooms can.
  app.get("/stats", async () => {
    let peopleOnline = 0;
    for (const info of rooms.values()) peopleOnline += realPeopleCount(info);
    return { peopleOnline };
  });

  // Private rooms are created explicitly so their password can be hashed
  // before any socket is admitted. Public rooms keep their existing
  // create-on-first-join behavior.
  app.post("/rooms", async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const room = typeof body.handle === "string" ? body.handle.trim() : "";
    const password = typeof body.password === "string" ? body.password.trim() : "";
    if (!HANDLE_RE.test(room) || !isPrivateRoom(room)) {
      return reply.code(400).send({ error: "invalid-room" });
    }
    if (password.length < ROOM_PASSWORD_MIN_LEN || password.length > ROOM_PASSWORD_MAX_LEN) {
      return reply.code(400).send({ error: "invalid-password" });
    }
    if (rooms.has(room) || roomsBeingCreated.has(room)) {
      return reply.code(409).send({ error: "room-exists" });
    }

    roomsBeingCreated.add(room);
    try {
      const passwordHash = await hashRoomPassword(password);
      if (rooms.has(room)) return reply.code(409).send({ error: "room-exists" });
      const roomInfo = createRoomInfo(room, passwordHash);
      rooms.set(room, roomInfo);
      schedulePrivateRoomCleanup(room, roomInfo);
      const grant = roomAccessTokens.issue(room);
      return {
        handle: room,
        private: true,
        requiresPassword: true,
        ...grant,
      };
    } finally {
      roomsBeingCreated.delete(room);
    }
  });

  // Deliberately minimal discovery for someone who already possesses a
  // private link: no participants, chat, timestamps, hash or tokens.
  app.get("/rooms/:handle/access", async (request) => {
    const { handle } = request.params as { handle?: string };
    const room = typeof handle === "string" ? handle : "";
    const roomInfo = HANDLE_RE.test(room) ? rooms.get(room) : undefined;
    return {
      exists: Boolean(roomInfo),
      private: isPrivateRoom(room),
      requiresPassword: Boolean(roomInfo?.passwordHash),
    };
  });

  app.post("/rooms/:handle/auth", async (request, reply) => {
    const { handle } = request.params as { handle?: string };
    const room = typeof handle === "string" ? handle : "";
    const roomInfo = HANDLE_RE.test(room) ? rooms.get(room) : undefined;
    if (!roomInfo || roomInfo.visibility !== "private") {
      return reply.code(404).send({ error: "room-not-found" });
    }
    // Secure behavior for any in-memory legacy private room that predates
    // password support: it must empty out and be recreated with a password.
    if (!roomInfo.passwordHash) {
      return reply.code(409).send({ error: "room-must-be-recreated" });
    }

    const rateKey = `${clientRateLimitAddress(request)}:${room}`;
    const limit = roomAuthRateLimiter.check(rateKey);
    if (!limit.allowed) {
      reply.header("Retry-After", String(limit.retryAfterSeconds));
      return reply.code(429).send({ error: "too-many-attempts" });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const password = typeof body.password === "string" ? body.password.trim() : "";
    const validLength =
      password.length >= ROOM_PASSWORD_MIN_LEN && password.length <= ROOM_PASSWORD_MAX_LEN;
    const passwordMatches =
      validLength && (await verifyRoomPassword(password, roomInfo.passwordHash));
    if (!passwordMatches) {
      roomAuthRateLimiter.recordFailure(rateKey);
      return reply.code(401).send({ error: "incorrect-password" });
    }

    roomAuthRateLimiter.clear(rateKey);
    return roomAccessTokens.issue(room);
  });

  // Public room directory. Private rooms (handle starts with "priv-") are
  // filtered out here, server-side — the client never receives them, so
  // there's no separate access-control step to forget on the frontend.
  app.get("/rooms", async () => {
    const publicRooms = [...rooms.entries()]
      .filter(([, info]) => info.visibility === "public")
      .map(([handle, info]) => ({
        handle,
        peopleCount: realPeopleCount(info),
        createdAt: info.createdAt,
      }))
      .sort((a, b) => b.peopleCount - a.peopleCount || a.createdAt - b.createdAt);
    return { rooms: publicRooms };
  });

  // Moderation surface, gated entirely behind ADMIN_USER/ADMIN_PASSWORD
  // (see adminAuth.ts) — every route below 404s outright if those env vars
  // aren't both set, so there's no accidental half-open admin endpoint on a
  // deployment that never opted in.
  app.post("/admin/login", async (request, reply) => {
    if (!ADMIN_ENABLED) return reply.code(404).send();
    if (!checkBasicAuth(request.headers.authorization)) {
      reply.header("WWW-Authenticate", 'Basic realm="admin"');
      return reply.code(401).send({ error: "unauthorized" });
    }
    return { token: createAdminToken() };
  });

  app.post("/admin/logout", async (request, reply) => {
    if (!ADMIN_ENABLED) return reply.code(404).send();
    const header = request.headers.authorization || "";
    if (header.startsWith("Bearer ")) revokeAdminToken(header.slice(7));
    return reply.code(204).send();
  });

  // Full room directory for moderators — unlike /rooms, this includes
  // private rooms and per-peer detail, since moderation is the one
  // legitimate reason to need that visibility.
  app.get("/admin/rooms", async (request, reply) => {
    if (!ADMIN_ENABLED) return reply.code(404).send();
    const header = request.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!verifyAdminToken(token)) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const allRooms = [...rooms.entries()]
      .map(([handle, info]) => ({
        handle,
        isPrivate: isPrivateRoom(handle),
        createdAt: info.createdAt,
        peopleCount: realPeopleCount(info),
        peers: [...info.sockets]
          .map((s) => clients.get(s))
          .filter((c): c is ClientInfo => c !== undefined && !c.isModerator)
          .map((c) => ({ id: c.id, name: c.name, sharing: c.sharing, mic: c.mic })),
      }))
      .sort((a, b) => b.peopleCount - a.peopleCount || a.createdAt - b.createdAt);
    return { rooms: allRooms };
  });

  // Site-wide banner shown to every connected socket (see broadcastToAll),
  // not scoped to a room. GET lets the admin panel show whether one's
  // already active on load; POST replaces it (and re-broadcasts); DELETE
  // ends it for everyone currently connected.
  app.get("/admin/announcement", async (request, reply) => {
    if (!ADMIN_ENABLED) return reply.code(404).send();
    const header = request.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!verifyAdminToken(token)) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    return { announcement: currentAnnouncement };
  });

  app.post("/admin/announcement", async (request, reply) => {
    if (!ADMIN_ENABLED) return reply.code(404).send();
    const header = request.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!verifyAdminToken(token)) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const text = typeof body.text === "string" ? body.text.trim().slice(0, ANNOUNCEMENT_TEXT_MAX_LEN) : "";
    const buttonLabel =
      typeof body.buttonLabel === "string"
        ? body.buttonLabel.trim().slice(0, ANNOUNCEMENT_BUTTON_LABEL_MAX_LEN)
        : "";
    const buttonAction = typeof body.buttonAction === "string" ? body.buttonAction : "";
    const color = typeof body.color === "string" ? body.color : "";
    const dismissible = Boolean(body.dismissible);
    const rawUrl = typeof body.buttonUrl === "string" ? body.buttonUrl.trim() : "";

    if (!isValidAnnouncementField(text, ANNOUNCEMENT_TEXT_MAX_LEN)) {
      return reply.code(400).send({ error: "Texto inválido." });
    }
    if (!isValidAnnouncementField(buttonLabel, ANNOUNCEMENT_BUTTON_LABEL_MAX_LEN)) {
      return reply.code(400).send({ error: "Label do botão inválido." });
    }
    if (!ANNOUNCEMENT_ACTIONS.has(buttonAction as AnnouncementButtonAction)) {
      return reply.code(400).send({ error: "Ação do botão inválida." });
    }
    if (!ANNOUNCEMENT_COLORS.has(color as AnnouncementColor)) {
      return reply.code(400).send({ error: "Cor inválida." });
    }
    const needsUrl = buttonAction !== "reload";
    if (needsUrl && !isValidAnnouncementUrl(rawUrl)) {
      return reply.code(400).send({ error: "Link inválido — use uma URL http(s) completa." });
    }

    currentAnnouncement = {
      id: genId(),
      text,
      buttonLabel,
      buttonAction: buttonAction as AnnouncementButtonAction,
      buttonUrl: needsUrl ? rawUrl : null,
      color: color as AnnouncementColor,
      dismissible,
    };
    broadcastToAll({ type: "announcement", announcement: currentAnnouncement });
    return { announcement: currentAnnouncement };
  });

  app.delete("/admin/announcement", async (request, reply) => {
    if (!ADMIN_ENABLED) return reply.code(404).send();
    const header = request.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!verifyAdminToken(token)) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    currentAnnouncement = null;
    broadcastToAll({ type: "announcement", announcement: null });
    return reply.code(204).send();
  });

  app.get("/ws", { websocket: true }, (socket: WebSocket) => {
    const info: ClientInfo = {
      id: genId(),
      name: null,
      room: null,
      sharing: false,
      mic: false,
      isAlive: true,
      socket,
    };
    clients.set(socket, info);
    send(socket, { type: "welcome", id: info.id });
    if (currentAnnouncement) {
      send(socket, { type: "announcement", announcement: currentAnnouncement });
    }

    socket.on("pong", () => {
      info.isAlive = true;
    });

    socket.on("message", (raw: Buffer) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!msg || typeof msg.type !== "string") return;

      switch (msg.type) {
        case "register": {
          const rawName = typeof msg.name === "string" ? msg.name.trim().slice(0, 24) : "";
          if (!isValidDisplayName(rawName)) {
            send(socket, { type: "register-error", message: "Nome inválido." });
            return;
          }

          // A client-supplied id (persisted client-side across reloads and
          // reconnects) lets a returning client reclaim its previous
          // identity instead of showing up as a stranger to everyone else's
          // still-open peer connections. If a stale session under that id
          // is still around (server restart wiped nothing since it's a
          // fresh process, but a plain reconnect can race the heartbeat
          // reaper), take it over cleanly first.
          const requestedClientId = typeof msg.clientId === "string" ? msg.clientId : "";
          const clientId = CLIENT_ID_RE.test(requestedClientId) ? requestedClientId : null;
          const existingById = clientId ? clientsById.get(clientId) : undefined;
          if (existingById && existingById.socket !== socket) {
            detachSession(existingById);
          }

          const key = rawName.toLowerCase();
          const existingByName = namesInUse.get(key);
          if (existingByName && existingByName !== socket) {
            send(socket, { type: "register-error", message: "Esse nome já está em uso." });
            return;
          }
          const previousName = info.name;
          if (info.name) namesInUse.delete(info.name.toLowerCase());
          info.name = rawName;
          namesInUse.set(key, socket);

          if (clientId && clientId !== info.id) {
            if (clientsById.get(info.id) === info) clientsById.delete(info.id);
            info.id = clientId;
          }
          clientsById.set(info.id, info);

          send(socket, { type: "registered", id: info.id, name: rawName });

          // Renaming while already in a room doesn't go through "join"
          // again, so nothing else would tell the other participants —
          // without this their peer list would keep showing the old name.
          if (info.room && previousName && previousName !== rawName) {
            broadcastToRoom(info.room, { type: "peer-renamed", id: info.id, name: rawName }, socket);
          }
          break;
        }
        case "join": {
          if (!info.name) {
            send(socket, { type: "error", message: "Registre um nome antes de entrar em uma sala." });
            return;
          }
          const room = typeof msg.room === "string" ? msg.room : "";
          if (!HANDLE_RE.test(room)) {
            send(socket, { type: "error", message: "Sala inválida." });
            return;
          }
          if (info.room === room) return;
          let roomInfo = rooms.get(room);
          if (isPrivateRoom(room)) {
            if (!roomInfo) {
              send(socket, { type: "join-error", room, code: "room-not-found" });
              return;
            }
            if (!roomInfo.passwordHash) {
              send(socket, { type: "join-error", room, code: "room-must-be-recreated" });
              return;
            }
            const accessToken = typeof msg.accessToken === "string" ? msg.accessToken : "";
            if (!roomAccessTokens.validate(room, accessToken)) {
              send(socket, { type: "join-error", room, code: "access-denied" });
              return;
            }
          } else if (!roomInfo) {
            roomInfo = createRoomInfo(room);
            rooms.set(room, roomInfo);
          }
          if (!roomInfo) return;
          if (info.room) leaveRoom(info);
          info.room = room;
          info.sharing = false;
          info.mic = false;
          if (roomInfo.cleanupTimer) {
            clearTimeout(roomInfo.cleanupTimer);
            roomInfo.cleanupTimer = undefined;
          }
          roomInfo.sockets.add(socket);
          const peers = [...roomInfo.sockets]
            .filter((s) => s !== socket)
            .map((s) => peerSummary(clients.get(s)!));
          send(socket, { type: "room-state", room, selfId: info.id, peers, messages: roomInfo.messages });
          flushPendingSignals(info);
          broadcastToRoom(room, { type: "peer-joined", id: info.id, name: info.name }, socket);
          break;
        }
        // A moderator entering a room to watch/listen for moderation.
        // Deliberately mirrors "join" (same room bookkeeping, same
        // room-state/peer-joined messages) so this socket rides the exact
        // same signal-relay and broadcaster-reactivity machinery a real
        // participant does — the only difference is the `role: "moderator"`
        // tag on its peer entry, which is what the client uses to keep it
        // out of the visible participant list/count. Leaving reuses the
        // plain "leave" message (and socket close already calls
        // leaveRoom() regardless), so no separate cleanup path is needed.
        case "admin-join": {
          if (!ADMIN_ENABLED) {
            send(socket, { type: "error", message: "Moderação desativada." });
            return;
          }
          const token = typeof msg.token === "string" ? msg.token : "";
          if (!verifyAdminToken(token)) {
            send(socket, { type: "error", message: "Não autorizado." });
            socket.terminate();
            return;
          }
          const room = typeof msg.room === "string" ? msg.room : "";
          if (!HANDLE_RE.test(room)) {
            send(socket, { type: "error", message: "Sala inválida." });
            return;
          }
          const roomInfo = rooms.get(room);
          if (!roomInfo) {
            send(socket, { type: "error", message: "Sala não encontrada ou já encerrada." });
            return;
          }
          if (info.room === room) return;
          if (info.room) leaveRoom(info);
          info.isModerator = true;
          info.name = info.name ?? "Moderador";
          info.room = room;
          info.sharing = false;
          info.mic = false;
          roomInfo.sockets.add(socket);
          const adminPeers = [...roomInfo.sockets]
            .filter((s) => s !== socket)
            .map((s) => peerSummary(clients.get(s)!));
          send(socket, {
            type: "room-state",
            room,
            selfId: info.id,
            peers: adminPeers,
            messages: roomInfo.messages,
          });
          flushPendingSignals(info);
          broadcastToRoom(room, { type: "peer-joined", id: info.id, name: info.name, role: "moderator" }, socket);
          break;
        }
        case "leave": {
          if (info.room) leaveRoom(info);
          break;
        }
        case "sharing": {
          if (!info.room) return;
          info.sharing = Boolean(msg.sharing);
          broadcastToRoom(info.room, { type: "peer-sharing", id: info.id, sharing: info.sharing });
          break;
        }
        case "mic": {
          if (!info.room) return;
          info.mic = Boolean(msg.mic);
          broadcastToRoom(info.room, { type: "peer-mic", id: info.id, mic: info.mic });
          break;
        }
        case "chat": {
          if (!info.room) return;
          const kind = msg.kind === "gif" ? "gif" : "text";
          const text = typeof msg.text === "string" ? msg.text.trim().slice(0, CHAT_MAX_LEN) : "";
          const url = typeof msg.url === "string" ? msg.url.trim() : "";
          if (kind === "gif" ? !isValidGifUrl(url) : !isValidChatText(text)) return;
          const roomInfo = rooms.get(info.room);
          if (!roomInfo) return;
          const chatMessage: ChatMessage = {
            id: genId(),
            from: info.id,
            name: info.name as string,
            text,
            ts: Date.now(),
            ...(kind === "gif" ? { kind, url } : {}),
          };
          roomInfo.messages.push(chatMessage);
          if (roomInfo.messages.length > ROOM_CHAT_HISTORY_LIMIT) {
            roomInfo.messages.splice(0, roomInfo.messages.length - ROOM_CHAT_HISTORY_LIMIT);
          }
          broadcastToRoom(info.room, { type: "chat-message", ...chatMessage });
          break;
        }
        case "signal": {
          if (!info.room) return;
          const targetId = typeof msg.to === "string" ? msg.to : "";
          if (!targetId) return;
          deliverOrQueueSignal(info.room, targetId, info.id, msg.data);
          break;
        }
        default:
          break;
      }
    });

    socket.on("close", () => {
      if (info.room) leaveRoom(info);
      // Guard against a stale/superseded session's delayed close event
      // wiping out a newer reconnect that already took over this name/id.
      if (info.name && namesInUse.get(info.name.toLowerCase()) === socket) {
        namesInUse.delete(info.name.toLowerCase());
      }
      if (clientsById.get(info.id) === info) {
        clientsById.delete(info.id);
        pendingSignals.delete(info.id);
      }
      clients.delete(socket);
    });
  });
}

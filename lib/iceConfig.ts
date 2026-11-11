// NEXT_PUBLIC_TURN_URLS aceita uma ou mais URLs separadas por vírgula.
// Cada entrada vazia precisa sumir: `"".split(",")` devolve `[""]`, e uma
// string vazia dentro de `urls` faz o RTCPeerConnection inteiro lançar
// `SyntaxError: '' is not a valid URL` — derrubando também o STUN que vem
// antes dela, ou seja, nenhuma conexão P2P é criada. Sem TURN configurado a
// entrada é omitida por completo em vez de entrar vazia.
function parseTurnUrls(raw: string): string[] {
  return raw
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
}

const STUN_SERVER: RTCIceServer = { urls: "stun:stun.l.google.com:19302" };

// One build-time TURN server: the URLs in a slot plus the single login they
// share. Returns null when the slot has no URLs, so an unconfigured slot is
// left out entirely instead of entering as a broken empty entry.
function staticServer(
  rawUrls: string | undefined,
  username: string | undefined,
  credential: string | undefined
): RTCIceServer | null {
  const urls = parseTurnUrls(rawUrls || "");
  if (urls.length === 0) return null;
  return { urls, username: username || "", credential: credential || "" };
}

// Our own TURN servers from the build's environment. Only the fallback: once
// the API hands out short-lived credentials (see ownDynamicServers below),
// those are used instead.
//
// Each slot is an independent server with its own login, so two VPSes with
// different usernames/passwords run side by side — the browser gathers relay
// candidates from every entry and ICE picks the best (usually the nearest).
// Slot 1 is the original unsuffixed trio; NEXT_PUBLIC_TURN_*_2 and _3 add
// more. Next inlines NEXT_PUBLIC_* only where it sees the literal variable
// name, so each slot is read explicitly — a key built at runtime
// (`process.env["..." + i]`) comes back undefined in the browser.
const STATIC_TURN_SERVERS: RTCIceServer[] = [
  staticServer(
    process.env.NEXT_PUBLIC_TURN_URLS,
    process.env.NEXT_PUBLIC_TURN_USERNAME,
    process.env.NEXT_PUBLIC_TURN_CREDENTIAL
  ),
  staticServer(
    process.env.NEXT_PUBLIC_TURN_URLS_2,
    process.env.NEXT_PUBLIC_TURN_USERNAME_2,
    process.env.NEXT_PUBLIC_TURN_CREDENTIAL_2
  ),
  staticServer(
    process.env.NEXT_PUBLIC_TURN_URLS_3,
    process.env.NEXT_PUBLIC_TURN_USERNAME_3,
    process.env.NEXT_PUBLIC_TURN_CREDENTIAL_3
  ),
].filter((server): server is RTCIceServer => server !== null);

// The VPS again, with credentials the API minted (coturn's "TURN REST API":
// an HMAC of an expiry time, see the API's ownTurn.ts). Replaces the static
// entry above when present, which is what makes it possible to retire the
// password that sits in the public bundle — anyone who reads it can use the
// VPS as a free relay, and every byte they push is bandwidth our own
// relayed calls then do not get. Empty until the API answers, and for good
// on a deployment that has not configured it.
let ownDynamicServers: RTCIceServer[] = [];

// Whether the build itself carries a TURN server. See isTurnConfigured for the
// question the UI actually needs answered, which also counts Cloudflare's.
export const TURN_CONFIGURED = STATIC_TURN_SERVERS.length > 0;

/** STUN plus the VPS TURN — what every connection gets before Cloudflare's servers arrive. */
export const ICE_CONFIG: RTCConfiguration = {
  iceServers: [STUN_SERVER, ...STATIC_TURN_SERVERS],
};

// Cloudflare's TURN servers, with short-lived credentials the API mints (see
// lib/iceServers.ts, the only writer). Empty until that answer lands, and for
// good on a deployment that has not configured Cloudflare.
let dynamicServers: RTCIceServer[] = [];
const listeners = new Set<() => void>();

// Whether this account may relay at all (entitlement "dedicated_turn", Pro).
// Starts false: the API only hands TURN credentials to Pro accounts, and the
// build's static entry is held to the same rule here — it sits in the public
// bundle, so this is the honest client's half, not the enforcement.
let turnAllowed = false;

/** Set from the account's features (see useRoomMedia). */
export function setTurnAllowed(allowed: boolean) {
  if (turnAllowed === allowed) return;
  turnAllowed = allowed;
  listeners.forEach((listener) => listener());
}

/** Whether the account may use TURN at all. */
export function isTurnAllowed(): boolean {
  return turnAllowed;
}

/** Replaces the TURN servers obtained at runtime. See lib/iceServers.ts. */
export function setDynamicIceServers(servers: RTCIceServer[]) {
  dynamicServers = servers;
  listeners.forEach((listener) => listener());
}

/** Replaces the VPS entry with API-minted credentials. See lib/iceServers.ts. */
export function setOwnIceServers(servers: RTCIceServer[]) {
  ownDynamicServers = servers;
  listeners.forEach((listener) => listener());
}

function urlsOf(server: RTCIceServer): string[] {
  return Array.isArray(server.urls) ? server.urls : [server.urls];
}

/** The VPS entries in use: the API's when it has sent any, the build's otherwise. */
function ownServers(): RTCIceServer[] {
  return ownDynamicServers.length > 0 ? ownDynamicServers : STATIC_TURN_SERVERS;
}

/**
 * The VPS entries restricted to TCP: `?transport=tcp` and `turns:` URLs only.
 * UDP to that server is being dropped somewhere, by its link or on the way:
 * compared side by side over 30 days (experiment "own-turn", 10k relayed
 * sessions), relaying over TCP delivered 2134 kbps at 21.2 fps where UDP
 * delivered 1537 at 20.4, with no more loss. Head-of-line blocking is the
 * textbook reason not to; this server is the exception. An entry left with
 * nothing is left as it was — a relay over UDP beats no relay at all.
 */
export function tcpOnlyServers(servers: RTCIceServer[]): RTCIceServer[] {
  return servers.map((server) => {
    const tcp = urlsOf(server).filter((url) => /^turns:/i.test(url) || /[?&]transport=tcp(?:&|$)/i.test(url));
    return tcp.length > 0 ? { ...server, urls: tcp } : server;
  });
}

/** For useSyncExternalStore: told whenever isTurnConfigured may have changed. */
export function subscribeIceServers(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function turnHost(url: string): string | null {
  const match = /^turns?:([^:?]+)/i.exec(url.trim());
  return match ? match[1].toLowerCase() : null;
}

/** Whether Cloudflare's TURN servers have been loaded — see lib/iceServers.ts. */
export function hasCloudflareTurn(): boolean {
  return dynamicServers.length > 0;
}

/**
 * Whether `url` (a TURN URL as the browser reports it on a relay candidate)
 * points at one of Cloudflare's servers. Matched by host against the set the
 * API handed out, rather than against a hard-coded name, so this stays right
 * whatever hostnames Cloudflare answers with.
 */
export function isCloudflareTurnUrl(url: string): boolean {
  const host = turnHost(url);
  if (!host) return false;
  return dynamicServers.some((server) =>
    (Array.isArray(server.urls) ? server.urls : [server.urls]).some((u) => turnHost(u) === host)
  );
}

/** Which TURN network a relay candidate's URL belongs to. */
export type TurnProvider = "cloudflare" | "own";

/**
 * Which of the site's TURN networks `url` is — for telling people which one a
 * relayed connection is on (see components/ConnectionStatsOverlay). Also
 * works for a URL the *other* end reported: both sides load the same servers.
 * The "cloudflare" host check is the fallback for that other end's report
 * arriving before our own Cloudflare servers have loaded. Null for anything
 * unrecognised or absent.
 */
export function turnProvider(url: string | null | undefined): TurnProvider | null {
  if (typeof url !== "string" || !url) return null;
  const host = turnHost(url);
  if (!host) return null;
  if (isCloudflareTurnUrl(url) || /(^|\.)cloudflare\.com$/.test(host)) return "cloudflare";
  if (STATIC_TURN_SERVERS.some((server) => urlsOf(server).some((u) => turnHost(u) === host))) return "own";
  if (ownDynamicServers.some((server) => urlsOf(server).some((u) => turnHost(u) === host))) return "own";
  return null;
}

/**
 * Whether any TURN server is available — the build's own or Cloudflare's.
 *
 * What "Impedir conexões diretas" (see WatchRoom.tsx) depends on:
 * iceTransportPolicy "relay" with no TURN server gathers zero usable
 * candidates. That is not "worse privacy", it is a connection that can never
 * establish at all, so the UI must disable that toggle when this is false.
 */
export function isTurnConfigured(): boolean {
  if (!turnAllowed) return false;
  return TURN_CONFIGURED || dynamicServers.length > 0 || ownDynamicServers.length > 0;
}

/**
 * The config to construct one RTCPeerConnection with, given the caller's own
 * "force TURN" preference.
 *
 * Cloudflare's servers go ahead of the VPS on purpose: the browser ranks relay
 * candidates by the order of the servers they came from, so when a connection
 * has to relay, it prefers Cloudflare's network and keeps the VPS as a
 * fallback. STUN still goes first, and relaying at all is only ever the last
 * resort — ICE picks a direct route whenever one works.
 *
 * With forceRelay, the connection is restricted to relay (TURN) candidates
 * only — our own host/srflx candidates are still gathered locally but never
 * offered to the remote peer, so it only ever learns a TURN server's address,
 * never our own. This is a per-side setting: it protects whoever sets it on
 * *their* own connections regardless of what the other end does, which is
 * exactly what "hide my IP from other participants" needs.
 */
export function iceConfigFor(forceRelay: boolean): RTCConfiguration {
  if (!turnAllowed) return { iceServers: [STUN_SERVER] };
  const config: RTCConfiguration = {
    iceServers: [STUN_SERVER, ...dynamicServers, ...tcpOnlyServers(ownServers())],
  };
  if (forceRelay && isTurnConfigured()) config.iceTransportPolicy = "relay";
  return config;
}

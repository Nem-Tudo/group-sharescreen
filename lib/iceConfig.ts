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

const TURN_URLS = parseTurnUrls(process.env.NEXT_PUBLIC_TURN_URLS || "");
const TURN_USERNAME = process.env.NEXT_PUBLIC_TURN_USERNAME || "";
const TURN_CREDENTIAL = process.env.NEXT_PUBLIC_TURN_CREDENTIAL || "";

const STUN_SERVER: RTCIceServer = { urls: "stun:stun.l.google.com:19302" };

// Our own TURN server on the VPS, from the build's environment.
const STATIC_TURN_SERVERS: RTCIceServer[] =
  TURN_URLS.length > 0 ? [{ urls: TURN_URLS, username: TURN_USERNAME, credential: TURN_CREDENTIAL }] : [];

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

/** Replaces the TURN servers obtained at runtime. See lib/iceServers.ts. */
export function setDynamicIceServers(servers: RTCIceServer[]) {
  dynamicServers = servers;
  listeners.forEach((listener) => listener());
}

/** For useSyncExternalStore: told whenever isTurnConfigured may have changed. */
export function subscribeIceServers(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
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
  return TURN_CONFIGURED || dynamicServers.length > 0;
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
  const config: RTCConfiguration = {
    iceServers: [STUN_SERVER, ...dynamicServers, ...STATIC_TURN_SERVERS],
  };
  if (forceRelay && isTurnConfigured()) config.iceTransportPolicy = "relay";
  return config;
}

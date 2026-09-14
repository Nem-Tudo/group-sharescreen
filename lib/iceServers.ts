import { setDynamicIceServers } from "./iceConfig";
import { getSignalingHttpBase } from "./roomsApi";

// Fetches Cloudflare's TURN servers from the API (see the API's
// cloudflareTurn.ts) and hands them to lib/iceConfig.ts, which puts them into
// every peer connection opened from then on.
//
// Never blocks a connection: anything opened before the answer lands gets STUN
// plus the VPS TURN, which is exactly what every connection had before this
// existed. In practice the answer wins, since a room is joined well before its
// first peer connection is.

// The API serves a set with at least a day left on it, and mints a new one
// once that is no longer true. Asking again an hour inside that mark means the
// next answer is the new set, and every connection opened in between still
// gets credentials with close to a day on them — longer than a call lasts,
// which matters because a TURN allocation dies with its credential.
const API_MIN_REMAINING_MS = 24 * 3600 * 1000;
const REFRESH_SLACK_MS = 3600 * 1000;
// After a failed request, or on a deployment without Cloudflare configured.
const RETRY_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8_000;

let started = false;
let timer: ReturnType<typeof setTimeout> | null = null;

function isUsableServer(value: unknown): value is RTCIceServer {
  if (!value || typeof value !== "object") return false;
  const server = value as { urls?: unknown; username?: unknown; credential?: unknown };
  // The same invariant lib/iceConfig.ts is built around: one empty or bogus
  // entry in `urls` makes the RTCPeerConnection constructor throw, which
  // would take down every connection — the direct ones included.
  if (!Array.isArray(server.urls) || server.urls.length === 0) return false;
  if (!server.urls.every((url) => typeof url === "string" && /^turns?:\S+$/i.test(url))) return false;
  return typeof server.username === "string" && typeof server.credential === "string";
}

function schedule(ms: number) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void load(), Math.max(60_000, ms));
}

async function load() {
  timer = null;
  const controller = new AbortController();
  const abort = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${getSignalingHttpBase()}/ice-servers`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { iceServers?: unknown; expiresAt?: unknown; disabled?: unknown };
    // The admin switched Cloudflare's TURN off. Unlike every other empty
    // answer, this one means "stop using what you have" — see the API's GET
    // /ice-servers. Connections opened from here on go without it.
    if (body.disabled === true) {
      setDynamicIceServers([]);
      schedule(RETRY_MS);
      return;
    }
    const servers = Array.isArray(body.iceServers) ? body.iceServers.filter(isUsableServer) : [];
    const expiresAt = typeof body.expiresAt === "number" ? body.expiresAt : null;
    if (servers.length === 0 || expiresAt === null || expiresAt <= Date.now()) {
      // Not configured, or Cloudflare not answering the API right now. Keep
      // whatever set is already in use (it may still have hours left) and
      // look again later.
      schedule(RETRY_MS);
      return;
    }
    setDynamicIceServers(servers);
    schedule(expiresAt - Date.now() - API_MIN_REMAINING_MS + REFRESH_SLACK_MS);
  } catch {
    schedule(RETRY_MS);
  } finally {
    clearTimeout(abort);
  }
}

/**
 * Starts keeping Cloudflare's TURN servers loaded, if it has not started yet.
 * Idempotent: every room mounts this, and only the first call does anything.
 */
export function ensureIceServers() {
  if (started || typeof window === "undefined") return;
  started = true;
  void load();
}

/**
 * Asks the API again right now, instead of at the next scheduled refresh —
 * the server said the TURN settings changed (the "ice-servers-changed"
 * message, sent when the admin switches Cloudflare on or off). A tab that
 * never needed ICE servers has nothing to refresh; it loads them when it does.
 */
export function refreshIceServers() {
  if (!started || typeof window === "undefined") return;
  if (timer) clearTimeout(timer);
  timer = null;
  void load();
}

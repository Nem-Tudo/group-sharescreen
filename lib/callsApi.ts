"use client";

import { getAccountToken } from "./accountApi";
import { getSignalingHttpBase } from "./roomsApi";
import type { CallWire } from "./signalingClient";
import { translate } from "@/lib/i18n";

// The calls client.
//
// Same division of labour as lib/dmApi.ts, and for the same reason: the *verb*
// is a request and the *news* is a socket push. Pressing "ligar" is an HTTP
// call that either starts a ring or says why it could not; being rung is
// something that arrives on its own, from the socket or from a notification.
//
// Nothing here holds state. The one thing a call *is* — whether it is still
// ringing — belongs to the server, because two devices can answer the same
// ring and exactly one of them may win.

function authHeaders(): Record<string, string> {
  const token = getAccountToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export type CallResult =
  | { ok: true; call: CallWire }
  | { ok: false; error: string };

// ─── Which calls are this tab's ───────────────────────────────────────────
//
// "call-accepted" reaches every connection of both people, and every one of
// them used to follow it into the room — which is how answering on one tab put
// the person in the call on all of them. Now only the tab that *placed* the
// call, or the one that *answered* it, walks in (see CallHost), and this is how
// it knows which calls those are.
//
// sessionStorage, which is per tab by definition, and survives the reload of a
// tab that placed a call and is still waiting on it. A memory copy as well, for
// the browser that refuses to store anything.

const OWN_CALLS_KEY = "golive:ownCalls";
// A call rings for under a minute; this only has to outlive the ring.
const OWN_CALLS_MAX = 20;
const ownCallsInMemory = new Set<string>();

function readOwnCalls(): string[] {
  try {
    const raw = window.sessionStorage.getItem(OWN_CALLS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** This tab placed or answered `callId`, so it is the one that joins the room. */
export function markOwnCall(callId: string): void {
  if (typeof window === "undefined") return;
  ownCallsInMemory.add(callId);
  const ids = readOwnCalls().filter((id) => id !== callId);
  ids.push(callId);
  try {
    window.sessionStorage.setItem(OWN_CALLS_KEY, JSON.stringify(ids.slice(-OWN_CALLS_MAX)));
  } catch {
    // The memory copy above still answers for the life of this page.
  }
}

export function isOwnCall(callId: string): boolean {
  if (typeof window === "undefined") return false;
  return ownCallsInMemory.has(callId) || readOwnCalls().includes(callId);
}

/**
 * Starts ringing somebody.
 *
 * `room` turns the call into an invitation: instead of minting an empty room
 * for the two of them, answering walks the other person into the room named
 * here — which is what "chamar para esta sala" is. The server refuses it
 * unless the caller is actually standing in that room, so this is a request
 * and not a claim.
 */
export async function startCall(userId: string, room?: string): Promise<CallResult> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/calls`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ to: userId, ...(room ? { room } : {}) }),
    });
    const data = (await res.json().catch(() => ({}))) as { call?: CallWire; error?: string };
    if (!res.ok || !data.call) {
      return { ok: false, error: data.error ?? translate("common.couldNotCall") };
    }
    // This tab is the one that walks into the room if it is answered.
    markOwnCall(data.call.id);
    return { ok: true, call: data.call };
  } catch {
    return { ok: false, error: translate("common.noConnectionToTheServer") };
  }
}

/**
 * Answers a call, and hands back the room to walk into.
 *
 * The room comes from the response rather than from the ring already on
 * screen, deliberately: answering from a cold start means the only thing this
 * client is sure of is the call id it read off a notification, and the server
 * is the one that knows whether that call is still open.
 */
export async function acceptCall(
  callId: string
): Promise<{ ok: true; roomHandle: string } | { ok: false; error: string }> {
  try {
    const res = await fetch(
      `${getSignalingHttpBase()}/calls/${encodeURIComponent(callId)}/accept`,
      { method: "POST", headers: authHeaders() }
    );
    const data = (await res.json().catch(() => ({}))) as {
      roomHandle?: string;
      error?: string;
    };
    if (!res.ok || !data.roomHandle) {
      return { ok: false, error: data.error ?? translate("callsApi.thatCallIsNoLongerRinging") };
    }
    return { ok: true, roomHandle: data.roomHandle };
  } catch {
    return { ok: false, error: translate("common.noConnectionToTheServer") };
  }
}

/**
 * Refuses a call, or gives up on one.
 *
 * One function for both because the only difference is which end is pressing
 * it, and the server already knows which end this account is.
 *
 * `reason` is the sentence somebody typed when refusing, and it is optional in
 * the strongest sense: the refusal is what matters and it happens regardless.
 * The server answers `noteDropped` when it delivered the refusal but not the
 * note (a blocked word, control characters), which is worth saying out loud —
 * quietly swallowing it would leave somebody believing they had explained
 * themselves.
 *
 * The promise is there for that one answer only. Nothing waits on it to take
 * the ring off the screen: a refusal that failed to send is corrected by the
 * call timing out, which is exactly what would have happened if the person had
 * ignored it.
 */
export async function endCall(
  callId: string,
  side: "decline" | "cancel",
  reason?: string
): Promise<{ noteDropped?: boolean }> {
  try {
    const res = await fetch(
      `${getSignalingHttpBase()}/calls/${encodeURIComponent(callId)}/${side}`,
      {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(reason ? { reason } : {}),
      }
    );
    return (await res.json().catch(() => ({}))) as { noteDropped?: boolean };
  } catch {
    return {};
  }
}

/**
 * What is ringing right now.
 *
 * The route that makes a cold start work: the app opens from a notification
 * with no socket, no session and nothing on screen, and this is how it finds
 * out there is a call to draw.
 */
export async function fetchPendingCalls(
  signal?: AbortSignal
): Promise<{ incoming: CallWire[]; outgoing: CallWire[] } | null> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/calls`, {
      headers: authHeaders(),
      signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as { incoming: CallWire[]; outgoing: CallWire[] };
  } catch {
    return null;
  }
}

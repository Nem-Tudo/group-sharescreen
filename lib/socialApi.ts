"use client";

import { getAccountToken } from "./accountApi";
import { getSignalingHttpBase } from "./roomsApi";

// The friends-and-blocks client. Every call here is a verb the API already
// enforces — nothing in this file decides who may do what, it only asks.
//
// Note what is deliberately absent: any local model of the graph. The one
// read below returns all four lists together, and every mutation is followed
// by re-reading it rather than by patching a cached copy. Two people acting on
// the same edge at once is normal here (they both press "adicionar"), and a
// client that maintains its own idea of the graph is a client that will
// eventually disagree with the server about who is whose friend.

export interface SocialUser {
  id: string;
  username: string;
  displayName: string;
  flags: string[];
  /** A bot account — the BOT tag after the name. Absent from an older API. */
  bot?: boolean;
  /**
   * Their picture and equipped name color, so a list of people can be drawn
   * to look like the same people a room's participant list draws.
   *
   * Optional on the type, not on the API: an older deployment answers without
   * them, and every consumer already has a null path (UserAvatar falls back to
   * a default face, DisplayUserName to the inherited color) — so a site that
   * ships ahead of the API degrades to what it drew before instead of
   * rendering holes.
   */
  avatarUrl?: string | null;
  nameColor?: string | null;
}

export interface SocialGraph {
  friends: SocialUser[];
  /** Requests waiting on *this* account to answer. */
  incoming: SocialUser[];
  /** Requests this account sent and nobody has answered. */
  outgoing: SocialUser[];
  blocked: SocialUser[];
}

export const EMPTY_GRAPH: SocialGraph = { friends: [], incoming: [], outgoing: [], blocked: [] };

function authHeaders(): Record<string, string> {
  const token = getAccountToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** The whole graph, or null when nobody is logged in / the API is down. */
export async function fetchSocialGraph(signal?: AbortSignal): Promise<SocialGraph | null> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/social`, {
      headers: authHeaders(),
      signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as SocialGraph;
  } catch {
    return null;
  }
}

/**
 * A search hit, which is a SocialUser plus where the two of you already stand
 * — so a result list can offer the one verb that applies instead of offering
 * "adicionar" for somebody who is already a friend.
 */
export interface SocialSearchHit extends SocialUser {
  relationship: "none" | "friends" | "incoming" | "outgoing";
}

/**
 * People matching a username, for the "adicionar" box. Never yourself, and
 * never anybody either of you blocked (see the API's /social/search).
 *
 * An empty list for a failed request as well as for no matches: this runs
 * while somebody types, and the next keystroke asks again anyway.
 */
export async function searchPeople(
  query: string,
  signal?: AbortSignal
): Promise<SocialSearchHit[]> {
  try {
    const res = await fetch(
      `${getSignalingHttpBase()}/social/search?q=${encodeURIComponent(query)}`,
      { headers: authHeaders(), signal }
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: SocialSearchHit[] };
    return data.results ?? [];
  } catch {
    return [];
  }
}

async function act(path: string, method: "POST" | "DELETE"): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}${path}`, {
      method,
      headers: authHeaders(),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: data.error ?? "Não foi possível concluir." };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Sem conexão com o servidor." };
  }
}

/** Sends a request — or accepts theirs, if one was already coming this way. */
export function addFriend(userId: string) {
  return act(`/social/friends/${encodeURIComponent(userId)}`, "POST");
}

export function acceptFriend(userId: string) {
  return act(`/social/friends/${encodeURIComponent(userId)}/accept`, "POST");
}

/**
 * Undoes the edge, whatever it is: refusing a request, cancelling one, or
 * removing a friend. One call because the server has one route — see its
 * socialRoutes.ts for why those three are the same operation.
 */
export function removeFriend(userId: string) {
  return act(`/social/friends/${encodeURIComponent(userId)}`, "DELETE");
}

export function blockUser(userId: string) {
  return act(`/social/blocks/${encodeURIComponent(userId)}`, "POST");
}

export function unblockUser(userId: string) {
  return act(`/social/blocks/${encodeURIComponent(userId)}`, "DELETE");
}

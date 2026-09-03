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

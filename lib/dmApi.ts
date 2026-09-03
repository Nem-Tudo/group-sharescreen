"use client";

import { getAccountToken } from "./accountApi";
import { getSignalingHttpBase } from "./roomsApi";
import type { SocialUser } from "./socialApi";

// The private-messages client.
//
// The division of labour with the socket is worth stating, because it is what
// keeps this simple: **the database is the conversation**, and the socket only
// ever says "something arrived". Every list here is read over HTTP, and a live
// message is appended to what was read. A missed push therefore costs a stale
// view until the next read — never a lost message, and never a client whose
// idea of the thread differs from the server's.

export interface DmReplyTo {
  id: string;
  name: string;
  text?: string;
  kind?: "text" | "gif" | "image";
  images?: string[];
}

export interface DirectMessage {
  id: string;
  from: string;
  to: string;
  text: string;
  /** Absent reads as "text" — see the API's dmModels. */
  kind?: "text" | "gif" | "image";
  url?: string;
  images?: string[];
  replyTo?: DmReplyTo | null;
  ts: number;
}

export interface Conversation {
  user: SocialUser;
  lastMessage: DirectMessage;
  unread: number;
}

function authHeaders(): Record<string, string> {
  const token = getAccountToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchConversations(
  signal?: AbortSignal
): Promise<{ conversations: Conversation[]; unread: number } | null> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/dm`, { headers: authHeaders(), signal });
    if (!res.ok) return null;
    return (await res.json()) as { conversations: Conversation[]; unread: number };
  } catch {
    return null;
  }
}

/**
 * A page of one conversation. `before` is the timestamp to page backwards
 * from — omit it for the newest page.
 */
export async function fetchConversation(
  userId: string,
  before?: number,
  signal?: AbortSignal
): Promise<{ user: SocialUser; messages: DirectMessage[] } | null> {
  try {
    const query = before ? `?before=${before}` : "";
    const res = await fetch(
      `${getSignalingHttpBase()}/dm/${encodeURIComponent(userId)}${query}`,
      { headers: authHeaders(), signal }
    );
    if (!res.ok) return null;
    return (await res.json()) as { user: SocialUser; messages: DirectMessage[] };
  } catch {
    return null;
  }
}

/**
 * One send for all three shapes, because the server has one route for them.
 *
 * `images` are data URLs, prepared and downscaled by lib/chatImage.ts exactly
 * as the room chat prepares its own — reusing that is what keeps a five-megabyte
 * phone photo from being five megabytes on the wire.
 */
export async function sendDirectMessage(
  userId: string,
  payload: {
    text?: string;
    /** Giphy URL, for a GIF message. */
    url?: string;
    /** Data URLs, uploaded by the API to the CDN. */
    images?: string[];
    replyTo?: DmReplyTo | null;
  }
): Promise<{ ok: true; message: DirectMessage } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/dm/${encodeURIComponent(userId)}`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        text: payload.text ?? "",
        ...(payload.url ? { url: payload.url } : {}),
        ...(payload.images && payload.images.length > 0 ? { images: payload.images } : {}),
        ...(payload.replyTo ? { replyTo: payload.replyTo } : {}),
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      message?: DirectMessage;
      error?: string;
    };
    if (!res.ok || !data.message) {
      return { ok: false, error: data.error ?? "Não foi possível enviar." };
    }
    return { ok: true, message: data.message };
  } catch {
    return { ok: false, error: "Sem conexão com o servidor." };
  }
}

/** Moves this account's bookmark to now. Fire-and-forget by design. */
export function markConversationRead(userId: string): void {
  void fetch(`${getSignalingHttpBase()}/dm/${encodeURIComponent(userId)}/read`, {
    method: "POST",
    headers: authHeaders(),
  }).catch(() => {
    // A bookmark that failed to move costs a badge that is still lit. It is
    // re-sent the next time the conversation is opened, so there is nothing
    // to report and nothing to retry.
  });
}

"use client";

import type { ChatAttachment } from "./chatAttachments";
import { getAccountToken } from "./accountApi";
import { getSignalingHttpBase } from "./roomsApi";
import type { SocialUser } from "./socialApi";
import { translate } from "@/lib/i18n";

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

/**
 * The line a call left in the conversation. Mirrors the API's DmCallInfo.
 *
 * It carries what happened, never a sentence: the same record reads as "você
 * ligou" on one side and "chamada perdida" on the other, and a stored
 * sentence would freeze both the language and the point of view (see
 * DirectMessagesModal's call row).
 */
export interface DmCallInfo {
  callId: string;
  roomHandle: string;
  state: "ringing" | "ongoing" | "ended" | "missed" | "declined" | "cancelled";
  startedAt?: number;
  endedAt?: number;
  /** How long they talked, on an answered call that has ended. */
  durationMs?: number;
}

export interface DirectMessage {
  id: string;
  from: string;
  to: string;
  text: string;
  /** Absent reads as "text" — see the API's dmModels. */
  kind?: "text" | "gif" | "image" | "call";
  /** What the call did, when `kind` is "call". Nothing else carries it. */
  call?: DmCallInfo;
  url?: string;
  images?: string[];
  /** Videos, audio and documents — see lib/chatAttachments. Absent when there are none. */
  attachments?: ChatAttachment[];
  replyTo?: DmReplyTo | null;
  /** Absent when nobody has reacted. The group chat's shape (see GroupReaction). */
  reactions?: DmReaction[];
  ts: number;
  /** When its author last changed the text. Absent on one never edited (and from an older API). */
  editedAt?: number;
  /**
   * The label this tab gave a message while it was still sending, echoed back
   * by the server on the response and on the socket. Only ever present on a
   * message this account just sent — it is how the placeholder on screen is
   * matched to the real message, whichever of the two copies lands first.
   */
  clientId?: string;
}

export interface DmReaction {
  emoji: string;
  users: string[];
}

/** Mirrors the API's DM_MAX_REACTIONS_PER_MESSAGE. */
export const DM_MAX_REACTIONS_PER_MESSAGE = 12;

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
): Promise<{ user: SocialUser; messages: DirectMessage[]; seenTs: number | null } | null> {
  try {
    const query = before ? `?before=${before}` : "";
    const res = await fetch(
      `${getSignalingHttpBase()}/dm/${encodeURIComponent(userId)}${query}`,
      { headers: authHeaders(), signal }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { user: SocialUser; messages: DirectMessage[]; seenTs?: number | null };
    // Absent from an API older than read receipts: nothing is known to be seen.
    return { ...data, seenTs: typeof data.seenTs === "number" ? data.seenTs : null };
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
    /** Receipts for files already uploaded — see lib/uploadApi. */
    attachments?: string[];
    replyTo?: DmReplyTo | null;
    /** See DirectMessage.clientId. */
    clientId?: string;
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
        ...(payload.attachments && payload.attachments.length > 0 ? { attachments: payload.attachments } : {}),
        ...(payload.replyTo ? { replyTo: payload.replyTo } : {}),
        ...(payload.clientId ? { clientId: payload.clientId } : {}),
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      message?: DirectMessage;
      error?: string;
    };
    if (!res.ok || !data.message) {
      return { ok: false, error: data.error ?? translate("common.couldNotSend") };
    }
    return { ok: true, message: data.message };
  } catch {
    return { ok: false, error: translate("common.noConnectionToTheServer") };
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

/**
 * Tells the other person this account is (or stopped) writing to them.
 * Fire-and-forget, like the group one: a lost signal is a "digitando…" that
 * shows a moment late or clears on its own (see lib/dmLive's expiry).
 */
export function sendDmTyping(userId: string, typing: boolean): void {
  void fetch(`${getSignalingHttpBase()}/dm/${encodeURIComponent(userId)}/typing`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ typing }),
  }).catch(() => {});
}

/** Puts this account's `emoji` on a message (`on`) or takes it back. */
export async function reactToDirectMessage(
  userId: string,
  messageId: string,
  emoji: string,
  on: boolean
): Promise<{ ok: true; reactions: DmReaction[] } | { ok: false; error: string }> {
  try {
    const res = await fetch(
      `${getSignalingHttpBase()}/dm/${encodeURIComponent(userId)}/messages/${encodeURIComponent(messageId)}/reactions`,
      {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ emoji, on }),
      }
    );
    const data = (await res.json().catch(() => ({}))) as { reactions?: DmReaction[]; error?: string };
    if (!res.ok || !Array.isArray(data.reactions)) {
      return { ok: false, error: data.error ?? translate("common.couldNotSend") };
    }
    return { ok: true, reactions: data.reactions };
  } catch {
    return { ok: false, error: translate("common.noConnectionToTheServer") };
  }
}

/** New text for one of this account's own messages; answers with the message as it now stands. */
export async function editDirectMessage(
  userId: string,
  messageId: string,
  text: string
): Promise<{ ok: true; message: DirectMessage } | { ok: false; error: string }> {
  try {
    const res = await fetch(
      `${getSignalingHttpBase()}/dm/${encodeURIComponent(userId)}/messages/${encodeURIComponent(messageId)}`,
      {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      }
    );
    const data = (await res.json().catch(() => ({}))) as { message?: DirectMessage; error?: string };
    if (!res.ok || !data.message) return { ok: false, error: data.error ?? translate("common.couldNotSave") };
    return { ok: true, message: data.message };
  } catch {
    return { ok: false, error: translate("common.noConnectionToTheServer") };
  }
}

/** Deletes one of this account's own messages, for both people. */
export async function deleteDirectMessage(
  userId: string,
  messageId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(
      `${getSignalingHttpBase()}/dm/${encodeURIComponent(userId)}/messages/${encodeURIComponent(messageId)}`,
      { method: "DELETE", headers: authHeaders() }
    );
    if (res.ok) return { ok: true };
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: data.error ?? translate("common.didnTWork") };
  } catch {
    return { ok: false, error: translate("common.noConnectionToTheServer") };
  }
}

export interface DmSettings {
  /** Whether "visto" is shared — mutual: off also hides when others read yours. */
  readReceipts: boolean;
}

export async function fetchDmSettings(): Promise<DmSettings | null> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/dm/settings`, { headers: authHeaders() });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<DmSettings>;
    return { readReceipts: data.readReceipts !== false };
  } catch {
    return null;
  }
}

export async function saveDmSettings(settings: DmSettings): Promise<DmSettings | null> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/dm/settings`, {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<DmSettings>;
    return { readReceipts: data.readReceipts !== false };
  } catch {
    return null;
  }
}

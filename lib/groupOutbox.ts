"use client";

import { useSyncExternalStore } from "react";
import { sendGroupMessage, type GroupReplyTo } from "./groupsApi";
import { onGroupMessage, publishGroupMessage } from "./useGroups";

// What this browser has written in a group's text rooms and the server has not
// confirmed yet — so a message is on screen the instant it is sent, not a
// round trip later, and typing the next one never waits on the last.
//
// Per room, a queue: messages go out one at a time and in the order written,
// however fast they are sent — firing them off in parallel would let a short
// one overtake a long one with a picture. A send that fails for a passing
// reason (no connection, the server asking to slow down) is tried again on its
// own; one the server refuses stays on screen, marked, to be retried or
// dropped by hand.
//
// Each message carries a nonce, its own name, which the server echoes on both
// its answer and the live broadcast (see the API's messages route). Whichever
// lands first swaps the placeholder for the real message — and a retry of a
// send that did go through gets that message back rather than a second copy.
//
// Held here rather than in the room's component so that leaving the room
// mid-send loses nothing: the queue keeps going, and coming back shows
// whatever is still on its way or failed.

export interface OutgoingMessage {
  nonce: string;
  groupId: string;
  channelId: string;
  text: string;
  url?: string;
  /** Data URLs, already downscaled — shown as they are until the server has the real ones. */
  images?: string[];
  mentions: string[];
  replyTo: GroupReplyTo | null;
  /** A guest's name at the moment of writing. */
  name: string | null;
  ts: number;
  status: "sending" | "failed";
  /** Set while a passing failure is being waited out. */
  retrying?: boolean;
  error?: string;
}

const MAX_RETRIES = 4;
const RETRY_BASE_MS = 800;
const EMPTY: OutgoingMessage[] = [];

let byChannel: Record<string, OutgoingMessage[]> = {};
const subscribers = new Set<() => void>();
const queues = new Map<string, Promise<void>>();

function commit(channelId: string, list: OutgoingMessage[]) {
  const next = { ...byChannel };
  if (list.length > 0) next[channelId] = list;
  else delete next[channelId];
  byChannel = next;
  subscribers.forEach((notify) => notify());
}

function find(channelId: string, nonce: string): OutgoingMessage | undefined {
  return byChannel[channelId]?.find((m) => m.nonce === nonce);
}

function patch(channelId: string, nonce: string, changes: Partial<OutgoingMessage>) {
  const list = byChannel[channelId];
  if (!list?.some((m) => m.nonce === nonce)) return;
  commit(channelId, list.map((m) => (m.nonce === nonce ? { ...m, ...changes } : m)));
}

function remove(channelId: string, nonce: string) {
  const list = byChannel[channelId];
  if (!list?.some((m) => m.nonce === nonce)) return;
  commit(channelId, list.filter((m) => m.nonce !== nonce));
}

function newNonce(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

// The live copy of a message can beat the HTTP answer — that settles it too.
let echoListenerInstalled = false;
function ensureEchoListener() {
  if (echoListenerInstalled) return;
  echoListenerInstalled = true;
  onGroupMessage((message, _author, nonce) => {
    if (nonce) remove(message.channelId, nonce);
  });
}

/** Whether a failed send is worth trying again by itself — the network or the server's pace, not a refusal. */
function isPassing(status: number): boolean {
  return status === 0 || status === 429 || status === 502 || status === 504;
}

async function deliver(channelId: string, nonce: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    const item = find(channelId, nonce);
    // Settled by the echo, dropped by hand, or already given up on.
    if (!item || item.status !== "sending") return;
    const result = await sendGroupMessage(item.groupId, channelId, {
      text: item.text,
      ...(item.url ? { url: item.url } : {}),
      ...(item.images ? { images: item.images } : {}),
      replyTo: item.replyTo,
      mentions: item.mentions,
      name: item.name,
      nonce,
    }).catch(() => ({ ok: false as const, status: 0, error: "Sem conexão com o servidor." }));
    if (result.ok) {
      // Both in the same tick, so the placeholder and the real message trade
      // places in one render — nothing blinks.
      remove(channelId, nonce);
      publishGroupMessage(result.message, result.author, nonce);
      return;
    }
    if (isPassing(result.status) && attempt < MAX_RETRIES) {
      patch(channelId, nonce, { retrying: true });
      await new Promise((resolve) => setTimeout(resolve, RETRY_BASE_MS * 2 ** attempt));
      continue;
    }
    patch(channelId, nonce, { status: "failed", retrying: false, error: result.error });
    return;
  }
}

function schedule(channelId: string, nonce: string) {
  const previous = queues.get(channelId) ?? Promise.resolve();
  const next = previous.then(() => deliver(channelId, nonce));
  queues.set(channelId, next);
  // Let go of the chain once it is idle, rather than growing it forever.
  void next.then(() => {
    if (queues.get(channelId) === next) queues.delete(channelId);
  });
}

/** Puts a message on screen and on its way. */
export function queueGroupMessage(
  input: Omit<OutgoingMessage, "nonce" | "ts" | "status" | "retrying" | "error">
): void {
  ensureEchoListener();
  const item: OutgoingMessage = { ...input, nonce: newNonce(), ts: Date.now(), status: "sending" };
  commit(item.channelId, [...(byChannel[item.channelId] ?? []), item]);
  schedule(item.channelId, item.nonce);
}

/** Sends a failed message again, with the same nonce — so it can never land twice. */
export function retryGroupMessage(channelId: string, nonce: string): void {
  const item = find(channelId, nonce);
  if (!item || item.status !== "failed") return;
  patch(channelId, nonce, { status: "sending", retrying: false, error: undefined });
  schedule(channelId, nonce);
}

/** Gives up on a failed message. */
export function discardGroupMessage(channelId: string, nonce: string): void {
  remove(channelId, nonce);
}

/** What is still on its way (or failed) in one room, oldest first. */
export function useOutbox(channelId: string): OutgoingMessage[] {
  return useSyncExternalStore(
    (notify) => {
      subscribers.add(notify);
      return () => {
        subscribers.delete(notify);
      };
    },
    () => byChannel[channelId] ?? EMPTY,
    () => EMPTY
  );
}

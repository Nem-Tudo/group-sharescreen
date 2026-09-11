import type { Conversation, DirectMessage } from "./dmApi";

// The arithmetic of one conversation on screen, kept apart from the dialog
// that draws it (components/DirectMessagesModal).
//
// Apart because this is where the conversation can go wrong in ways nobody
// sees until it happens to them: a message shown twice, a message that
// vanished on send, two messages in the wrong order, a page of history that
// jumped the queue. Every one of those is a question about lists, and a
// question about lists can be tested without drawing anything — see
// dmThread.test.mts.
//
// There are three sources for what a thread holds, and they overlap:
//
//   - the page read over HTTP, which is the truth as of when it was read;
//   - what the socket delivered since, which is newer but may repeat the page;
//   - what this tab sent and the server confirmed, which may repeat either.
//
// They are reconciled by id, and a message this tab is still sending is
// matched by the label it gave it (`clientId`) rather than by an id it does
// not have yet.

/** Mirrors the API's DM_PAGE_SIZE — a full page means there may be more. */
export const DM_PAGE_SIZE = 50;

/**
 * Everything in one conversation, oldest first, each message once.
 *
 * `page` is what was read; `live` is the socket's buffer, which holds every
 * conversation's deliveries and is filtered here to the pair in question.
 */
export function threadMessages(
  page: readonly DirectMessage[],
  live: readonly DirectMessage[],
  me: string,
  other: string
): DirectMessage[] {
  const byId = new Map<string, DirectMessage>();
  for (const message of page) byId.set(message.id, message);
  for (const message of live) {
    if (byId.has(message.id)) continue;
    const inThread =
      (message.from === other && message.to === me) ||
      (message.from === me && message.to === other);
    if (inThread) byId.set(message.id, message);
  }
  // Stable, and by the server's timestamp: arrival order is not send order
  // once three sources are interleaved.
  return [...byId.values()].sort((a, b) => a.ts - b.ts);
}

/**
 * The placeholders still worth drawing: this thread's, minus any whose real
 * message is already there. The socket copy usually lands before the HTTP
 * response does, and without this the message would briefly show twice.
 */
export function unconfirmed<P extends { clientId: string; to: string }>(
  pending: readonly P[],
  messages: readonly DirectMessage[],
  other: string | null
): P[] {
  const delivered = new Set<string>();
  for (const message of messages) if (message.clientId) delivered.add(message.clientId);
  return pending.filter((entry) => entry.to === other && !delivered.has(entry.clientId));
}

/**
 * A freshly read page, replacing what was there — without dropping whatever
 * is *newer* than the page. A message confirmed while the read was in flight
 * is exactly that, and a plain replace made it disappear.
 */
export function withFreshPage(
  previous: readonly DirectMessage[] | null,
  page: readonly DirectMessage[]
): DirectMessage[] {
  const newest = page.length > 0 ? page[page.length - 1].ts : 0;
  const pageIds = new Set(page.map((message) => message.id));
  const carried = (previous ?? []).filter(
    (message) => message.ts > newest && !pageIds.has(message.id)
  );
  return [...page, ...carried];
}

/** An older page, in front of what is loaded. Overlap at the seam is dropped. */
export function withOlderPage(
  current: readonly DirectMessage[],
  older: readonly DirectMessage[]
): DirectMessage[] {
  const known = new Set(current.map((message) => message.id));
  return [...older.filter((message) => !known.has(message.id)), ...current];
}

/** One confirmed send, added unless a copy is already there. */
export function withConfirmed(
  current: readonly DirectMessage[],
  message: DirectMessage
): DirectMessage[] {
  return current.some((existing) => existing.id === message.id)
    ? [...current]
    : [...current, message];
}

/** Whether a page came back full, and so whether there may be more before it. */
export function mayHaveMore(page: readonly DirectMessage[]): boolean {
  return page.length >= DM_PAGE_SIZE;
}

/** The newest message this person sent, by id — what the read bookmark follows. */
export function newestFrom(messages: readonly DirectMessage[], userId: string | null): string | null {
  if (!userId) return null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].from === userId) return messages[i].id;
  }
  return null;
}

/**
 * The conversation list with whatever arrived since it was read laid over it:
 * each row's newest line, and the order, move the moment a message lands.
 *
 * Unread counts are deliberately left alone. Only the server knows what was
 * read on another device, and a count guessed here would flash a wrong number
 * until the next read corrected it.
 */
export function liveConversationList(
  conversations: readonly Conversation[],
  live: readonly DirectMessage[],
  me: string
): Conversation[] {
  const byUser = new Map(conversations.map((row) => [row.user.id, { ...row }]));
  for (const message of live) {
    const other = message.from === me ? message.to : message.from;
    const row = byUser.get(other);
    if (row && message.ts > row.lastMessage.ts) row.lastMessage = message;
  }
  return [...byUser.values()].sort((a, b) => b.lastMessage.ts - a.lastMessage.ts);
}

/**
 * Runs tasks strictly one after another, in the order they were handed in.
 *
 * Messages are drawn the instant they are written, so nothing is gained by
 * sending them in parallel — and a lot is lost: two sends racing each other
 * reach the server in whichever order the network likes, and the server
 * stamps the time on arrival, so they would be stored swapped.
 *
 * A task that throws does not stop the ones after it. A bare `.then` chain
 * would: one rejected link and every later message silently never leaves.
 */
export function createSendQueue(): (task: () => Promise<void>) => Promise<void> {
  let tail: Promise<void> = Promise.resolve();
  return (task) => {
    const run = tail.then(task);
    tail = run.catch(() => {});
    return run;
  };
}

import { attachmentsPreview } from "./chatAttachments";
import type { Conversation, DirectMessage, DmCallInfo, DmReaction } from "./dmApi";
import { translate } from "./i18n";

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

/** What became of a message since it was read: deleted by its author, or its text edited. */
export type DmChange = { deleted: true } | { deleted?: false; text: string; editedAt: number };

/**
 * Messages with what was heard since laid over them (see lib/dmLive): the
 * deleted ones gone, the edited ones carrying their new text. An edit only
 * wins over a copy that is not newer than it — a page read after a second
 * edit already holds that one.
 */
export function withChanges(
  messages: readonly DirectMessage[],
  changes: Readonly<Record<string, DmChange>>
): DirectMessage[] {
  const out: DirectMessage[] = [];
  for (const message of messages) {
    const change = changes[message.id];
    if (!change) out.push(message);
    else if (change.deleted) continue;
    else if (change.editedAt >= (message.editedAt ?? 0)) {
      out.push({ ...message, text: change.text, editedAt: change.editedAt });
    } else out.push(message);
  }
  return out;
}

/**
 * The conversation list with whatever arrived since it was read laid over it:
 * each row's newest line, and the order, move the moment a message lands —
 * and an edit shows there too. A deleted delivery no longer counts as a row's
 * newest line; a deleted line the list itself was read with stays until the
 * list is read again, since only the server knows what came before it.
 *
 * Unread counts are deliberately left alone. Only the server knows what was
 * read on another device, and a count guessed here would flash a wrong number
 * until the next read corrected it.
 */
export function liveConversationList(
  conversations: readonly Conversation[],
  live: readonly DirectMessage[],
  me: string,
  changes: Readonly<Record<string, DmChange>> = {}
): Conversation[] {
  const byUser = new Map(
    conversations.map((row) => [
      row.user.id,
      { ...row, lastMessage: withChanges([row.lastMessage], changes)[0] ?? row.lastMessage },
    ])
  );
  for (const message of withChanges(live, changes)) {
    const other = message.from === me ? message.to : message.from;
    const row = byUser.get(other);
    if (row && message.ts > row.lastMessage.ts) row.lastMessage = message;
  }
  // Pinned first, newest first inside each half — the order the server sends
  // (see the API's listConversations), kept here because this rebuilds it
  // from what arrived live.
  return [...byUser.values()].sort(
    (a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.lastMessage.ts - a.lastMessage.ts
  );
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

/**
 * A message's reactions: the newest of what its page said and what was heard
 * since (see lib/dmLive). An update heard *before* the page was read is older
 * than the page, and loses to it.
 */
export function reactionsFor(
  message: Pick<DirectMessage, "id" | "reactions">,
  updates: Readonly<Record<string, { reactions: DmReaction[]; at: number }>>,
  pageReadAt: number
): DmReaction[] {
  const update = updates[message.id];
  if (update && update.at >= pageReadAt) return update.reactions;
  // One shared empty list, so a message nobody reacted to reads the same on
  // every render (the thread's bubbles are memoised on it).
  return message.reactions ?? NO_REACTIONS;
}

const NO_REACTIONS: DmReaction[] = [];

/**
 * How far the other person has read, as far as this screen may say: the later
 * of what the page said and what arrived live — and nothing at all while this
 * account has "visto" switched off, which is the mutual half of that switch.
 */
export function seenThrough(
  pageSeenTs: number | null,
  liveSeenTs: number | undefined,
  readReceipts: boolean | null
): number | null {
  if (readReceipts === false) return null;
  const best = Math.max(pageSeenTs ?? 0, liveSeenTs ?? 0);
  return best > 0 ? best : null;
}

/**
 * The newest delivery that is *not* part of the open conversation, by id —
 * what the conversation list re-reads on. The open thread's own traffic
 * changes nothing the list can only learn from the server (its unread count
 * is being cleared by reading it), and re-reading on each of those was a pair
 * of aggregations per message.
 */
export function newestOutside(
  live: readonly DirectMessage[],
  me: string,
  openWith: string | null
): string | null {
  for (let i = live.length - 1; i >= 0; i -= 1) {
    const message = live[i];
    const other = message.from === me ? message.to : message.from;
    if (other !== openWith) return message.id;
  }
  return null;
}

/**
 * The newest delivery a conversation list read earlier cannot account for on
 * its own, by id — what the header's strip and the unread badge re-read on.
 *
 * Something received moves an unread count, which only the server knows. A
 * message this account sent does not: the live overlay (liveConversationList)
 * already moves its row, so re-reading on each send was an aggregation on the
 * server per message typed. The one exception is a send to somebody the list
 * does not have yet — a new conversation, which only a read can add. With no
 * list (`listed` null), only what was received counts.
 */
export function newestListChange(
  live: readonly DirectMessage[],
  me: string,
  listed: readonly Conversation[] | null
): string | null {
  for (let i = live.length - 1; i >= 0; i -= 1) {
    const message = live[i];
    if (message.from !== me) return message.id;
    if (listed && !listed.some((row) => row.user.id === message.to)) return message.id;
  }
  return null;
}

/**
 * What a message says in one line. A picture or a GIF has no text of its own,
 * and the old list drew an empty line under the name for both.
 */
export function messageSummary(
  message: Pick<DirectMessage, "text" | "kind" | "images"> &
    Pick<Partial<DirectMessage>, "attachments" | "call">
): string {
  // A call has no text of its own either: the line the conversation keeps is
  // what happened, said here in the fewest words the list has room for (the
  // thread itself says it properly — see DirectMessagesModal's call row).
  if (message.kind === "call") return callSummary(message.call?.state);
  if (message.text) return message.text;
  if (message.kind === "gif") return "GIF";
  const count = message.images?.length ?? 0;
  if (count > 1) return `${count} imagens`;
  if (count === 1 || message.kind === "image") return translate("common.image");
  return attachmentsPreview(message.attachments);
}

/** A call's line in the conversation list. See messageSummary. */
function callSummary(state: DmCallInfo["state"] | undefined): string {
  switch (state) {
    case "ended":
      return translate("dmThread.callEnded");
    case "missed":
      return translate("dmThread.callMissed");
    case "declined":
      return translate("dmThread.callDeclined");
    case "cancelled":
      return translate("dmThread.callCancelled");
    default:
      return translate("common.call");
  }
}

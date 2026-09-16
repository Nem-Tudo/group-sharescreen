"use client";

import type { PendingAttachment } from "@/lib/useAttachmentUploads";

// What somebody had half-written in a room, kept while the tab is open.
//
// The composer is unmounted the moment you go anywhere else — TextChannelView
// is keyed on the room (see GroupPages), so switching rooms, opening a
// profile, or walking into a call takes the box and everything in it with it.
// Coming back used to hand you an empty box; now it hands you what you were
// writing.
//
// sessionStorage, not localStorage, and that is the point rather than a
// detail: a draft is part of "what I am doing right now". It should survive a
// click into another room and a reload, and it should *not* still be sitting
// there next week in a tab you opened for something else — least of all a
// half-written message to somebody, on a shared computer, in a room you no
// longer remember opening. Closing the tab is the end of it.
//
// Nothing here ever throws. Storage is missing in a private window, blocked by
// site-data settings, and full at unpredictable sizes; a draft is a
// convenience, and a convenience that can break the composer is worse than no
// draft at all.

export interface ComposerDraft {
  text: string;
  /** Pasted or picked pictures, as the data URLs the composer holds. */
  images: { dataUrl: string; bytes: number }[];
  /**
   * Files that finished uploading, with the receipts the message will carry.
   *
   * Only the finished ones: an upload still in flight is aborted when the
   * composer goes away (see useAttachmentUploads), and the File behind it is
   * gone from memory — there would be nothing to resume. The receipts are
   * good for seven days (the API's RECEIPT_TTL), which outlasts any tab.
   */
  attachments: PendingAttachment[];
}

const PREFIX = "sharescreen:draft:";

/**
 * The ceiling on one stored draft, in characters of JSON.
 *
 * sessionStorage is somewhere around 5 MB for the whole origin and throws when
 * it is full, so one room's pasted screenshots must not be able to take the
 * budget every other room's text is also living in. Over this, the pictures
 * are dropped and the words are kept — a picture can be pasted again from
 * wherever it came from, while a paragraph somebody wrote exists nowhere else.
 */
const MAX_DRAFT_CHARS = 1_000_000;

/** A key per room, so two rooms never see each other's half-written message. */
export function groupDraftKey(groupId: string, channelId: string): string {
  return `${PREFIX}group:${groupId}:${channelId}`;
}

function isEmpty(draft: ComposerDraft): boolean {
  return draft.text.trim() === "" && draft.images.length === 0 && draft.attachments.length === 0;
}

export function readDraft(key: string): ComposerDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ComposerDraft> | null;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      text: typeof parsed.text === "string" ? parsed.text : "",
      images: Array.isArray(parsed.images)
        ? parsed.images.filter(
            (image): image is { dataUrl: string; bytes: number } =>
              Boolean(image) && typeof (image as { dataUrl?: unknown }).dataUrl === "string"
          )
        : [],
      // Re-checked rather than trusted: this is our own JSON from a moment
      // ago, but it is also the one thing here that can put an entry in the
      // attachment tray, and a malformed one would draw a row with no name.
      attachments: Array.isArray(parsed.attachments)
        ? parsed.attachments.filter(
            (item): item is PendingAttachment =>
              Boolean(item) &&
              typeof (item as { token?: unknown }).token === "string" &&
              Boolean((item as { attachment?: unknown }).attachment)
          )
        : [],
    };
  } catch {
    return null;
  }
}

export function writeDraft(key: string, draft: ComposerDraft): void {
  if (typeof window === "undefined") return;
  try {
    // An empty draft is a deleted one, not a stored empty string: otherwise
    // every room ever opened leaves a row behind for the rest of the session.
    if (isEmpty(draft)) {
      window.sessionStorage.removeItem(key);
      return;
    }
    let payload = JSON.stringify(draft);
    if (payload.length > MAX_DRAFT_CHARS) {
      payload = JSON.stringify({ ...draft, images: [] });
    }
    window.sessionStorage.setItem(key, payload);
  } catch {
    // Full, or unavailable. The composer goes on working with what it has in
    // memory; only coming back to it later is lost.
  }
}

export function clearDraft(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // ignored — see writeDraft.
  }
}

"use client";

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
  type Ref,
} from "react";
import { MdCheck, MdClose, MdEdit, MdGif, MdGroups, MdSend, MdTune, MdVolumeUp } from "react-icons/md";
import { AttachMenu, splitPicked } from "@/components/AttachMenu";
import { AttachmentTray } from "@/components/AttachmentTray";
import { EmojiPickerButton } from "@/components/EmojiPicker";
import { EmojiSuggestions } from "@/components/EmojiSuggestions";
import { GifPicker } from "@/components/GifPicker";
import { HighlightedTextarea, highlightMentions } from "@/components/HighlightedTextarea";
import { Popover } from "@/components/Tooltip";
import { UserAvatar } from "@/components/UserAvatar";
import type { ChatAttachment } from "@/lib/chatAttachments";
import {
  CHAT_IMAGE_MAX_PER_MESSAGE,
  CHAT_IMAGE_TOTAL_MAX_BYTES,
  isSupportedChatImage,
  prepareChatImage,
} from "@/lib/chatImage";
import {
  applyMentionInsertion,
  buildMentionsRegex,
  filterMentionCandidates,
  getMentionTriggerInfo,
  normalizeSearch,
  tokenizeMentions,
} from "@/lib/chatMentions";
import type { GroupReplyTo } from "@/lib/groupsApi";
import { EVERYONE_MENTION, OFFLINE_MENTION, ONLINE_MENTION, ROLE_MENTION_PREFIX } from "@/lib/groupPermissions";
import {
  blankSpans,
  findMentionExprs,
  isWritableRole,
  mayMention,
  typedAtomResolver,
  type MentionExprSpan,
  type NamedRole,
} from "@/lib/mentionExpr";
import { encodeMentions, userTokenIds, type Named } from "@/lib/messageTokens";
import { createTypingAnnouncer, type TypingAnnouncer } from "@/lib/typing";
import { registerMentionHandler, type MentionTarget } from "@/lib/groupMentionBridge";
import { useAttachmentUploads } from "@/lib/useAttachmentUploads";
import { useEmojiAutocomplete } from "@/lib/useEmojiAutocomplete";
import { useT } from "@/lib/useI18n";

// The box at the bottom of a group's text room. Drawn like the room chat's own
// composer (components/ChatPanel) — a text field and small icon buttons along
// the bottom edge of the panel — so writing in a group feels like writing in a
// room. Behaviour follows the DM composer, plus @mentions of the group's
// members, which the "só menções" notification level is built on.

export interface MentionCandidate {
  /**
   * A member's id, a room's id, ROLE_MENTION_PREFIX + a role's id, one of
   * the site's own mentions (EVERYONE_MENTION, ONLINE_MENTION,
   * OFFLINE_MENTION) or MENTION_BUILDER.
   */
  id: string;
  name: string;
  avatarUrl: string | null;
  /** A role's colour, for its suggestion. */
  color?: string | null;
  /** Set on a room offered after "#": which kind, for its icon. */
  room?: "text" | "voice";
  /** Other words that find it ("todos" for @everyone, "here" for @online). */
  aliases?: string[];
}

/**
 * "@mention" in the suggestions: not a mention at all but the way into the
 * mention editor (MentionBuilderDialog) — picking it swaps the typed "@men…"
 * for whatever the editor builds.
 */
export const MENTION_BUILDER = "@mention";

// The site's own mentions, the same in every group — see lib/mentionExpr.
export const EVERYONE_CANDIDATE: MentionCandidate = {
  id: EVERYONE_MENTION,
  name: "everyone",
  avatarUrl: null,
  aliases: ["todos"],
};
export const ONLINE_CANDIDATE: MentionCandidate = { id: ONLINE_MENTION, name: "online", avatarUrl: null, aliases: ["here"] };
export const OFFLINE_CANDIDATE: MentionCandidate = { id: OFFLINE_MENTION, name: "offline", avatarUrl: null };
export const MENTION_BUILDER_CANDIDATE: MentionCandidate = {
  id: MENTION_BUILDER,
  name: "mention",
  avatarUrl: null,
  aliases: ["mencao", "editor"],
};

const SITE_MENTIONS = new Set([EVERYONE_MENTION, ONLINE_MENTION, OFFLINE_MENTION, MENTION_BUILDER]);

/** The site's own mentions — pinned to the top of the suggestions whenever they match. */
function isSiteMention(candidate: MentionCandidate): boolean {
  return SITE_MENTIONS.has(candidate.id);
}

// A member's id never starts with "@"; everything that is not a person does,
// but for a room, which is marked.
function isPerson(candidate: MentionCandidate): boolean {
  return !candidate.room && !candidate.id.startsWith("@");
}

/** A role as the composer reads it in "{@Admin&@online}" — see lib/mentionExpr. */
export type ComposerRole = NamedRole & { color: string | null };

/**
 * Whether `index` sits inside a "{" not yet closed on its line — an
 * expression being written, where only what an expression can hold is offered.
 */
function insideOpenBrace(text: string, index: number): boolean {
  let depth = 0;
  for (let i = text.lastIndexOf("\n", index - 1) + 1; i < index; i += 1) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}" && depth > 0) depth -= 1;
  }
  return depth > 0;
}

/**
 * encodeMentions on everything but the expressions: a name inside
 * "{@Ana&@online}" is a role's, and must not become a person's token.
 */
function encodeAround(text: string, spans: MentionExprSpan[], people: Named[], rooms: Named[]): string {
  if (spans.length === 0) return encodeMentions(text, people, rooms);
  let out = "";
  let last = 0;
  for (const span of spans) {
    out += encodeMentions(text.slice(last, span.start), people, rooms) + text.slice(span.start, span.end);
    last = span.end;
  }
  return out + encodeMentions(text.slice(last), people, rooms);
}

// How long typing may pause before the people search asks the API. Short
// enough to feel like the list answering the keys, long enough that a name
// typed at speed is one request rather than one per letter.
const SEARCH_DEBOUNCE_MS = 200;
// People found by searching are remembered for turning a typed name into a
// mention on send, whether or not it was picked — bounded, since a long
// session of searching would otherwise hold everybody it ever saw.
const MAX_REMEMBERED = 200;
// A room's name may be longer than a person's before the "#" stops counting.
const ROOM_QUERY_MAX = 32;

/**
 * What this person may send in this room (see lib/groupPermissions) — the
 * composer only leaves out what the server would refuse. Sending at all is
 * `disabledReason`'s business.
 */
export interface ComposerAllowances {
  gifs: boolean;
  images: boolean;
}

export interface ComposerPayload {
  text: string;
  url?: string;
  images?: string[];
  /** Receipts for videos and documents already uploaded — see lib/useAttachmentUploads. */
  attachments?: string[];
  /** Those same files as they will be drawn, for the message shown before the server answers. */
  files?: ChatAttachment[];
  mentions: string[];
}

/**
 * One of this person's own messages, opened in the box to be changed: its
 * text as it reads — "@Name" and "#room", not the ids it carries — and the
 * people those names stand for, so saving turns them back into the same ids
 * even when somebody else shares the name.
 */
export interface ComposerEdit {
  id: string;
  text: string;
  people: Named[];
}

/** What the room does to the box from outside it — see TextChannelView. */
export interface ComposerHandle {
  /** Opens a message for editing; whatever was being written waits, and comes back after. */
  startEdit(edit: ComposerEdit): void;
  /** Stops editing, without saving — only if it is `messageId` being edited, when given. */
  cancelEdit(messageId?: string): void;
}

const MAX_LENGTH = 2000;

const NO_CANDIDATES: MentionCandidate[] = [];
const NO_ROLES: ComposerRole[] = [];
// A long message gets room to be read while it is written: the box grows with
// it up to this share of the screen, and only then starts to scroll.
const MAX_HEIGHT_OF_SCREEN = 0.8;
// Never so tall that the conversation above it is squeezed out entirely.
const MIN_CONVERSATION_PX = 64;

/** Which members a text @-mentions, by id — matched by name, longest names first. */
export function mentionedIds(text: string, candidates: MentionCandidate[]): string[] {
  const regex = buildMentionsRegex(candidates.map((c) => c.name));
  if (!regex) return [];
  const ids = new Set<string>();
  for (const token of tokenizeMentions(text, regex)) {
    if (token.type !== "mention") continue;
    const wanted = normalizeSearch(token.name);
    for (const candidate of candidates) {
      if (normalizeSearch(candidate.name) === wanted) ids.add(candidate.id);
    }
  }
  return [...ids];
}

function isCoarsePointer(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(pointer: coarse)").matches);
}

// Where a key pressed with nothing in particular focused may be taken over
// by the box (see the effect that uses this). Whatever has the focus, or is
// open on top, gets its keys first:
//
//   - a field of any kind already takes typing — this box included;
//   - a menu, list or dialog that has the focus reads letters as its own
//     (type-ahead, shortcuts), and space presses whatever button is focused;
//   - a dialog, menu or panel open anywhere (a picker, a sheet, a profile)
//     means the person is busy with that, not with this room;
//   - and the box has to actually be on screen and uncovered: a backdrop
//     over it is a modal this list does not know by name.
const KEYS_OF_THEIR_OWN =
  '[role="menu"], [role="menubar"], [role="listbox"], [role="tree"], [role="grid"], [role="slider"], [role="tablist"], [role="radiogroup"], [role="dialog"]';
const OPEN_ON_TOP =
  '[aria-modal="true"], [role="menu"], .tippy-box[data-theme~="golive-panel"]:not([data-state="hidden"])';

function canTakeOverTyping(box: HTMLTextAreaElement, key: string): boolean {
  const active = document.activeElement as HTMLElement | null;
  if (active && active !== document.body && active !== document.documentElement) {
    if (active.isContentEditable || active.matches("input, textarea, select")) return false;
    if (key === " " || active.closest(KEYS_OF_THEIR_OWN)) return false;
  }
  if (document.querySelector(OPEN_ON_TOP)) return false;
  const rect = box.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  const composer = box.closest("[data-composer]") ?? box;
  return Boolean(hit && composer.contains(hit));
}

// Sized and nudged to sit centred on the text box's first line (48px tall),
// and to stay on its bottom edge as the box grows.
const iconButton =
  "mb-1 flex h-10 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-zinc-200";

export function GroupMessageComposer({
  ref,
  channelName,
  candidates,
  rooms = [],
  roles = NO_ROLES,
  onOpenMentionBuilder,
  searchPeople,
  replyingTo,
  onCancelReply,
  onSend,
  onSubmitEdit,
  onEditingChange,
  onEditLast,
  disabledReason,
  allow = { gifs: true, images: true },
  onTypingChange,
}: {
  ref?: Ref<ComposerHandle>;
  channelName: string;
  /**
   * What "@" offers without asking anybody: @everyone, the roles, and the
   * people this room already knows (who is online, who has written here).
   * Everybody else is found through `searchPeople` as their name is typed —
   * the whole membership is never loaded.
   */
  candidates: MentionCandidate[];
  /** What "#" offers: the rooms this person can see. */
  rooms?: MentionCandidate[];
  /**
   * Every role in the group, highest first — what the names inside a mention
   * expression ("{@Admin&@online}") are read against, and what is offered
   * inside one. All of them, not only the ones this person may mention: an
   * expression may narrow a mention they are allowed by any role at all (see
   * lib/mentionExpr's mayMention), and the API has the last word.
   */
  roles?: ComposerRole[];
  /**
   * Opens the mention editor; `insert` puts what it builds into the box.
   * Without it, "@mention" is not offered.
   */
  onOpenMentionBuilder?: (insert: (text: string) => void) => void;
  /** Members whose name contains the text — asked as somebody types after "@". */
  searchPeople?: (query: string) => Promise<MentionCandidate[]>;
  replyingTo: GroupReplyTo | null;
  onCancelReply: () => void;
  /**
   * Takes the message and returns at once — the box empties the moment Enter
   * is pressed, and the next message can be typed while this one is still on
   * its way (see lib/groupOutbox, which shows it and delivers it).
   */
  onSend: (payload: ComposerPayload) => void;
  /**
   * The new text of the message being edited (see ComposerHandle.startEdit),
   * encoded like a message sent. Empty when everything was erased — the room
   * decides what that means. The box is back to what it held before the edit
   * by the time this is called.
   */
  onSubmitEdit?: (messageId: string, payload: ComposerPayload) => void;
  /** Which message the box is editing, as that changes — null when none. */
  onEditingChange?: (messageId: string | null) => void;
  /** ↑ in an empty box: Discord's way into editing your last message. */
  onEditLast?: () => void;
  disabledReason?: string | null;
  allow?: ComposerAllowances;
  /**
   * True when a burst of typing starts and again every few seconds while it
   * lasts; false when it stops, the box is emptied, or the composer goes away
   * mid-burst. Not on send: the message itself is what clears the line on
   * everybody else's screen. Timing in lib/typing's createTypingAnnouncer.
   */
  onTypingChange?: (typing: boolean) => void;
}) {
  const t = useT();
  const [text, setText] = useState("");
  const [images, setImages] = useState<{ dataUrl: string; bytes: number }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [gifOpen, setGifOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [highlight, setHighlight] = useState(0);
  const [mentionDismissed, setMentionDismissed] = useState<number | null>(null);
  // The last search's answer, tagged with what was searched — read as empty
  // for any other query, so a change of query needs no effect to clear it.
  const [found, setFound] = useState<{ query: string; people: MentionCandidate[] }>({
    query: "",
    people: [],
  });
  // People picked from the suggestions in the message being written, by
  // name. They come first when names are turned into mentions on send, so
  // somebody who shares a name with whoever was picked never takes the mention.
  const picked = useRef(new Map<string, MentionCandidate>());
  // Everybody any search has turned up, for a name typed out in full rather
  // than picked. Insertion-ordered, oldest dropped first.
  const remembered = useRef(new Map<string, MentionCandidate>());
  // The names of everybody picked or turned up by a search, for colouring
  // them in the box. The refs above are what send reads; this is the same set
  // held as state, so a search landing re-renders with the new names lit.
  const [extraNames, setExtraNames] = useState<string[]>([]);
  function rememberNames(names: string[]) {
    setExtraNames((current) => {
      const next = new Set(current);
      for (const name of names) next.add(name);
      if (next.size === current.length) return current;
      return [...next].slice(-MAX_REMEMBERED);
    });
  }
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  // Videos and documents, uploading from the moment they are picked. They
  // stay put through an edit (which changes words only) and go with the next
  // message sent.
  const uploads = useAttachmentUploads("groups");

  // The message being edited, if any — the box then holds its text instead
  // of a new message, and whatever was being written before waits in `draft`
  // (pictures and picks included) until the edit is saved or dropped.
  const [editing, setEditing] = useState<ComposerEdit | null>(null);
  const draft = useRef<{
    text: string;
    images: { dataUrl: string; bytes: number }[];
    picked: Map<string, MentionCandidate>;
  } | null>(null);

  function startEdit(edit: ComposerEdit) {
    if (disabled) return;
    if (!editing) draft.current = { text, images, picked: new Map(picked.current) };
    // What an edit is typed over is not a new message: nobody is told
    // somebody is writing (a burst already announced ends here).
    typingRef.current?.input("");
    picked.current = new Map(
      edit.people.map((person) => [normalizeSearch(person.name), { ...person, avatarUrl: null }])
    );
    rememberNames(edit.people.map((person) => person.name));
    setEditing(edit);
    setText(edit.text);
    setImages([]);
    setCursor(edit.text.length);
    setError(null);
    onEditingChange?.(edit.id);
    requestAnimationFrame(() => {
      const el = textRef.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      el.setSelectionRange(el.value.length, el.value.length);
      resize();
    });
  }

  function endEdit() {
    const saved = draft.current;
    draft.current = null;
    picked.current = saved?.picked ?? new Map();
    setEditing(null);
    setText(saved?.text ?? "");
    setImages(saved?.images ?? []);
    setCursor(saved?.text.length ?? 0);
    setError(null);
    onEditingChange?.(null);
    requestAnimationFrame(resize);
  }

  useImperativeHandle(ref, () => ({
    startEdit,
    cancelEdit: (messageId?: string) => {
      if (editing && (!messageId || editing.id === messageId)) endEdit();
    },
  }));

  // Pressing "Responder" is asking to write: the box takes the focus, cursor
  // at the end of whatever was already typed, so the next key lands in it.
  // Keyed by the message, so answering a different one focuses again.
  const replyId = replyingTo?.id ?? null;
  useEffect(() => {
    const el = textRef.current;
    if (!replyId || !el || el.disabled) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, [replyId]);

  // Opening a room is opening it to write in: the box takes the focus when it
  // appears, so the first key typed lands in it. This mounts once per room
  // (TextChannelView is keyed by it), so every room opened does this. Not on
  // a touch screen, where a focused box is a keyboard sliding up over the
  // conversation somebody came to read.
  useEffect(() => {
    const el = textRef.current;
    if (!el || el.disabled || isCoarsePointer()) return;
    el.focus({ preventScroll: true });
  }, []);

  // And it stays the place typing goes: with the focus anywhere else in the
  // room — after clicking a message, a member, a button — a key that types
  // something moves the focus to the box, cursor at the end, and the key
  // lands in it. Focusing during keydown is enough for that: the character
  // is inserted into whatever holds the focus once keydown is over, so
  // nothing is re-typed by hand. A dead key (the ´ of "é") and a paste move
  // the focus the same way, so the accent and the pasted text land here too.
  // Only when nothing else wants the key — see canTakeOverTyping.
  //
  // The focus moves last, from a listener added to `window` while the key is
  // still on its way up — one added mid-dispatch runs after those already
  // there. That is where the call shortcuts listen (lib/keyboardShortcuts),
  // and a one-letter shortcut that took the key cancels it: the box then
  // leaves the focus where it was instead of grabbing it for a letter that
  // never arrives.
  useEffect(() => {
    function onKeyDown(e: globalThis.KeyboardEvent) {
      const el = textRef.current;
      if (!el || el.disabled || e.defaultPrevented || e.isComposing) return;
      // AltGr arrives as Ctrl+Alt on Windows, and types characters.
      const altGraph = e.getModifierState?.("AltGraph") ?? false;
      const paste = (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "v";
      if (!paste) {
        if (!altGraph && (e.ctrlKey || e.metaKey || e.altKey)) return;
        if (e.key.length !== 1 && e.key !== "Dead") return;
      }
      if (!canTakeOverTyping(el, e.key)) return;
      window.addEventListener(
        "keydown",
        (late) => {
          if (late !== e || e.defaultPrevented || textRef.current !== el || el.disabled) return;
          el.focus({ preventScroll: true });
          el.setSelectionRange(el.value.length, el.value.length);
        },
        { once: true }
      );
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // "Digitando..." — see onTypingChange and lib/typing's createTypingAnnouncer,
  // which decides when. Handed the latest handler through a ref, so the
  // announcer made once per mount never calls a stale one.
  const onTypingChangeRef = useRef(onTypingChange);
  useEffect(() => {
    onTypingChangeRef.current = onTypingChange;
  }, [onTypingChange]);
  const typingRef = useRef<TypingAnnouncer | null>(null);
  useEffect(() => {
    const announcer = createTypingAnnouncer((value) => onTypingChangeRef.current?.(value));
    typingRef.current = announcer;
    // Leaving the room (or the page) mid-sentence says so now, rather than
    // leaving everybody else to wait out TextChannelView's TYPING_EXPIRE_MS.
    return () => {
      announcer.dispose();
      typingRef.current = null;
    };
  }, []);
  function noteTyping(value: string) {
    if (editing) return;
    if (onTypingChangeRef.current) typingRef.current?.input(value);
  }

  // "@" for people and roles, "#" for rooms — whichever was typed last before
  // the cursor, since that is the one being written.
  const atTrigger = getMentionTriggerInfo(text, cursor, "@");
  const hashTrigger =
    rooms.length > 0 ? getMentionTriggerInfo(text, cursor, "#", ROOM_QUERY_MAX) : atTrigger;
  const trigger =
    rooms.length > 0 &&
    hashTrigger.isTriggered &&
    (!atTrigger.isTriggered || hashTrigger.startIndex > atTrigger.startIndex)
      ? { ...hashTrigger, char: "#" as const }
      : { ...atTrigger, char: "@" as const };

  // Inside a "{" still open: an expression is being written, and it can only
  // hold the site's mentions and roles — people are not offered, nor searched.
  const inExpression = trigger.isTriggered && trigger.char === "@" && insideOpenBrace(text, trigger.startIndex);

  const searchQuery = trigger.isTriggered && trigger.char === "@" && !inExpression ? trigger.query.trim() : "";
  // Asked of the API as a name is typed, for everybody the room does not
  // already know. The answer lands in a timer's callback, never in the effect
  // itself, and is tagged with its query so a stale one is simply not read.
  useEffect(() => {
    if (!searchPeople || !searchQuery) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void searchPeople(searchQuery)
        .then((people) => {
          if (cancelled) return;
          for (const person of people) {
            remembered.current.delete(person.id);
            remembered.current.set(person.id, person);
          }
          while (remembered.current.size > MAX_REMEMBERED) {
            const oldest = remembered.current.keys().next();
            if (oldest.done) break;
            remembered.current.delete(oldest.value);
          }
          setFound({ query: searchQuery, people });
          rememberNames(people.map((person) => person.name));
        })
        .catch(() => {});
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchPeople, searchQuery]);
  const searched = found.query === searchQuery ? found.people : NO_CANDIDATES;

  // Every role, as a suggestion inside an expression — but one whose name the
  // expression could not hold ("R&D") or would read as another role.
  const roleCandidates = useMemo(
    () =>
      roles.filter((r) => isWritableRole(r, roles)).map((r): MentionCandidate => ({
        id: `${ROLE_MENTION_PREFIX}${r.id}`,
        name: r.name,
        avatarUrl: null,
        color: r.color,
      })),
    [roles]
  );
  const suggestions = useMemo(() => {
    if (!trigger.isTriggered) return NO_CANDIDATES;
    if (trigger.char === "#") return filterMentionCandidates(rooms, trigger.query).slice(0, 8);
    if (inExpression) {
      return filterMentionCandidates(
        [EVERYONE_CANDIDATE, ONLINE_CANDIDATE, OFFLINE_CANDIDATE, ...roleCandidates],
        trigger.query,
        isSiteMention
      ).slice(0, 8);
    }
    // Ranked together, so an exact match found by the search is not buried
    // under a looser one the room happened to know already — except the
    // site's own mentions, which go on top whenever they match at all.
    const offered = onOpenMentionBuilder ? candidates : candidates.filter((c) => c.id !== MENTION_BUILDER);
    const known = new Set(offered.map((c) => c.id));
    const pool = [...offered, ...searched.filter((c) => !known.has(c.id))];
    return filterMentionCandidates(pool, trigger.query, isSiteMention).slice(0, 8);
  }, [trigger.isTriggered, trigger.char, trigger.query, inExpression, candidates, rooms, roleCandidates, searched, onOpenMentionBuilder]);
  const mentionOpen =
    trigger.isTriggered && suggestions.length > 0 && mentionDismissed !== trigger.startIndex;

  // Reading "{@Admin&@online}": role names against every role, and what this
  // person may send read off what the room offers them — @everyone is there
  // only for whoever may mention it, and a role only when they may mention it
  // (see TextChannelView's candidates). The API applies the same rule.
  const resolveTyped = useMemo(() => typedAtomResolver(roles), [roles]);
  const rights = useMemo(() => {
    const ids = new Set(candidates.map((c) => c.id));
    return { everyone: ids.has(EVERYONE_MENTION), role: (id: string) => ids.has(`${ROLE_MENTION_PREFIX}${id}`) };
  }, [candidates]);
  const findExpressions = useCallback(
    (value: string) =>
      findMentionExprs(value, resolveTyped).map((span) => ({ ...span, allowed: mayMention(span.expr, rights) })),
    [resolveTyped, rights]
  );

  // What lights up blue in the box: every name send would turn into a
  // mention — the people, roles and site mentions this room offers, anybody
  // picked or found by a search, the expressions this person may send — and
  // the rooms after "#". An expression they may not send stays plain, and so
  // do the names inside it: it goes out as text, alerting nobody.
  const peopleRegex = useMemo(
    () =>
      buildMentionsRegex([...candidates.filter((c) => c.id !== MENTION_BUILDER).map((c) => c.name), ...extraNames]),
    [candidates, extraNames]
  );
  const roomRegex = useMemo(() => buildMentionsRegex(rooms.map((r) => r.name), "#"), [rooms]);
  const highlights = useMemo(() => {
    if (!/[@#]/.test(text)) return null;
    const expressions = (value: string) =>
      findExpressions(value).map((span) => ({ start: span.start, end: span.end, plain: !span.allowed }));
    return highlightMentions(text, [expressions, peopleRegex, roomRegex]);
  }, [text, findExpressions, peopleRegex, roomRegex]);
  const disabled = Boolean(disabledReason);

  function resize() {
    const el = textRef.current;
    if (!el) return;
    // The screen's share, or less on a screen too short to spare it: the
    // chat column the box sits in (TextChannelView) keeps a strip of the
    // conversation visible above it.
    let cap = window.innerHeight * MAX_HEIGHT_OF_SCREEN;
    const column = el.closest<HTMLElement>("[data-chat-column]");
    const box = el.closest<HTMLElement>("[data-composer]");
    if (column && box) {
      const around = box.offsetHeight - el.offsetHeight;
      cap = Math.min(cap, column.clientHeight - MIN_CONVERSATION_PX - around);
    }
    el.style.height = "auto";
    // scrollHeight leaves out the border, which the border-box height includes.
    const wanted = el.scrollHeight + (el.offsetHeight - el.clientHeight);
    const height = Math.max(Math.min(wanted, cap), 0);
    el.style.height = `${height}px`;
    // No scrollbar until the text actually outgrows the box.
    el.style.overflowY = wanted > cap ? "auto" : "hidden";
  }

  // The cap is a share of the screen, so a resized window moves it.
  useEffect(() => {
    const onResize = () => resize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  });

  // ":" for emoji, ":sob:" → 😭, and the picker beside "send" — see
  // useEmojiAutocomplete. Everything it changes comes back through here.
  const emoji = useEmojiAutocomplete({
    textareaRef: textRef,
    onReplace: (value, caret) => {
      const next = value.slice(0, MAX_LENGTH);
      setText(next);
      setCursor(Math.min(caret, next.length));
      noteTyping(next);
      requestAnimationFrame(resize);
    },
  });

  function onChange(e: ChangeEvent<HTMLTextAreaElement>) {
    const { text: value, caret } = emoji.handleChange(
      e.target.value,
      e.target.selectionStart ?? e.target.value.length
    );
    setText(value.slice(0, MAX_LENGTH));
    setCursor(caret);
    setHighlight(0);
    setError(null);
    resize();
    noteTyping(value);
  }

  function pickMention(candidate: MentionCandidate) {
    // "@mention": the typed "@men…" goes, and the editor opens — whatever it
    // builds lands where that was (see insertBuilt).
    if (candidate.id === MENTION_BUILDER) {
      const at = trigger.startIndex;
      const next = text.slice(0, at) + text.slice(cursor);
      setText(next);
      setCursor(at);
      noteTyping(next);
      onOpenMentionBuilder?.((built) => insertBuilt(built, at));
      return;
    }
    if (isPerson(candidate)) picked.current.set(normalizeSearch(candidate.name), candidate);
    rememberNames([candidate.name]);
    // Inside an expression no space follows: "{@Admin" is waiting for its "&"
    // or "}", and the suggestions stay shut until the next "@".
    const { newText, newCursorPos } = inExpression
      ? (() => {
          const before = text.slice(0, trigger.startIndex);
          const inserted = `@${candidate.name}`;
          return { newText: before + inserted + text.slice(cursor), newCursorPos: before.length + inserted.length };
        })()
      : applyMentionInsertion(text, cursor, trigger.startIndex, candidate.name, trigger.char);
    if (inExpression) setMentionDismissed(trigger.startIndex);
    setText(newText);
    setCursor(newCursorPos);
    noteTyping(newText);
    requestAnimationFrame(() => {
      const el = textRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(newCursorPos, newCursorPos);
      resize();
    });
  }

  // The text as it is now, for insertBuilt — which runs from the editor's
  // dialog, well after the render that handed it over.
  const latestText = useRef(text);
  useEffect(() => {
    latestText.current = text;
  });

  /** What the mention editor built, put in at `at` — spaced off from whatever it lands between. */
  function insertBuilt(built: string, at: number) {
    const current = latestText.current;
    const pos = Math.min(at, current.length);
    const before = current.slice(0, pos);
    const after = current.slice(pos);
    const lead = before && !/[\s(]$/.test(before) ? " " : "";
    const trail = after.startsWith(" ") ? "" : " ";
    const inserted = `${lead}${built}${trail}`;
    const newText = (before + inserted + after).slice(0, MAX_LENGTH);
    const newCursorPos = Math.min(before.length + inserted.length, newText.length);
    setText(newText);
    setCursor(newCursorPos);
    setError(null);
    noteTyping(newText);
    requestAnimationFrame(() => {
      const el = textRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(newCursorPos, newCursorPos);
      resize();
    });
  }

  // Shift+click on somebody elsewhere on the page (see lib/groupMentionBridge):
  // "@Name " where the cursor was, marked as picked so it goes out as their
  // mention even if somebody else shares the name — exactly as choosing them
  // from the suggestions would.
  function insertMention(target: MentionTarget) {
    if (disabled) return;
    const candidate: MentionCandidate = { id: target.id, name: target.name, avatarUrl: target.avatarUrl };
    picked.current.set(normalizeSearch(candidate.name), candidate);
    rememberNames([candidate.name]);
    const el = textRef.current;
    // The box's own caret when it has one; the end otherwise, which is where
    // somebody who was not writing expects a name to land.
    const at = el && document.activeElement === el ? el.selectionStart ?? text.length : text.length;
    const before = text.slice(0, at);
    const after = text.slice(at);
    const lead = before && !/\s$/.test(before) ? " " : "";
    const trail = after.startsWith(" ") ? "" : " ";
    const inserted = `${lead}@${candidate.name}${trail}`;
    const newText = (before + inserted + after).slice(0, MAX_LENGTH);
    const newCursorPos = Math.min(before.length + inserted.length, newText.length);
    setText(newText);
    setCursor(newCursorPos);
    setError(null);
    noteTyping(newText);
    requestAnimationFrame(() => {
      const box = textRef.current;
      if (!box) return;
      box.focus();
      box.setSelectionRange(newCursorPos, newCursorPos);
      resize();
    });
  }
  // Registered once per mount, calling whichever insertMention is current —
  // it closes over the text, which changes on every key.
  const insertMentionRef = useRef(insertMention);
  useEffect(() => {
    insertMentionRef.current = insertMention;
  });
  useEffect(() => {
    if (disabled) return;
    return registerMentionHandler((target) => insertMentionRef.current(target));
  }, [disabled]);

  function send(extra: { url?: string } = {}) {
    if (disabled) return;
    const trimmed = emoji.convert(text).trim();
    const hasFiles = !extra.url && !editing && uploads.items.length > 0;
    if (!trimmed && images.length === 0 && !extra.url && !editing && !hasFiles) return;
    // The files have to be on the CDN before the message can name them.
    if (hasFiles && uploads.uploading) {
      setError(t("attachments.stillUploading"));
      return;
    }
    if (hasFiles && uploads.failed) {
      setError(t("attachments.removeFailedFiles"));
      return;
    }

    // What goes out carries ids, not names (see lib/messageTokens): "@Ana"
    // becomes <@her id> and "#geral" becomes <#its id>, and the API reads who
    // was mentioned off those. Roles, @everyone, @online and @offline stay as
    // typed and still travel in `mentions`, matched against what this room
    // offers. So do expressions ("{@Admin&@online}", see lib/mentionExpr),
    // as their "@expr:…" entry — and only the ones this person may send; one
    // they may not goes out as plain text. Either way the names inside one
    // are its own: not people to encode, not roles to mention on their own.
    // An edit is encoded the same way.
    const expressions = extra.url ? [] : findExpressions(trimmed);
    const outside = blankSpans(trimmed, expressions);
    const expressionEntries = expressions.filter((span) => span.allowed).map((span) => span.entry);
    const special = candidates.filter((c) => !isPerson(c) && c.id !== MENTION_BUILDER);
    // The keywords too, whether or not this person may use them: "@online"
    // typed out is never a member who happens to be called that.
    const specialNames = new Set([...special.map((c) => normalizeSearch(c.name)), "everyone", "online", "offline"]);
    const people: Named[] = [
      // Picked ones first, so they win any name they share.
      ...picked.current.values(),
      // Then anybody else the room knows or a search turned up — for a name
      // typed out in full. One that is also a role's name is left to the role
      // unless it was picked as a person.
      ...[...candidates.filter(isPerson), ...remembered.current.values()].filter(
        (c) => !specialNames.has(normalizeSearch(c.name))
      ),
    ];
    const encoded = extra.url ? "" : encodeAround(trimmed, expressions, people, rooms);
    const mentions = extra.url
      ? []
      : [...new Set([...mentionedIds(outside, special), ...expressionEntries, ...userTokenIds(encoded)])];
    // An id is longer than most names, so a message that fitted as typed can
    // outgrow the limit once encoded — and the API would cut it, splitting a
    // token in half. Better to say so than to send a broken mention.
    if (encoded.length > MAX_LENGTH) {
      setError(t("groups.groupMessageComposer.theMessageGotTooLongWith"));
      return;
    }
    setError(null);
    if (editing) {
      const messageId = editing.id;
      endEdit();
      onSubmitEdit?.(messageId, { text: encoded, mentions });
      textRef.current?.focus();
      return;
    }
    onSend({
      text: encoded,
      ...(extra.url ? { url: extra.url } : {}),
      ...(!extra.url && images.length > 0 ? { images: images.map((i) => i.dataUrl) } : {}),
      ...(hasFiles ? { attachments: uploads.tokens, files: uploads.attachments } : {}),
      // The people are in the text now; they ride here too only so an API
      // from before the tokens still alerts them.
      mentions,
    });
    picked.current.clear();
    // A GIF goes on its own and leaves whatever was being typed alone.
    if (!extra.url) {
      typingRef.current?.sent();
      setText("");
      setImages([]);
      uploads.clear();
      setCursor(0);
      requestAnimationFrame(resize);
    }
    textRef.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (emoji.handleKeyDown(e)) return;
    if (mentionOpen) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : -1;
        setHighlight((h) => (h + step + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickMention(suggestions[Math.min(highlight, suggestions.length - 1)]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionDismissed(trigger.startIndex);
        return;
      }
    }
    if (e.key === "Escape" && editing) {
      e.preventDefault();
      endEdit();
      return;
    }
    if (e.key === "Escape" && replyingTo) {
      e.preventDefault();
      onCancelReply();
      return;
    }
    if (
      e.key === "ArrowUp" &&
      onEditLast &&
      !editing &&
      !text &&
      images.length === 0 &&
      uploads.items.length === 0 &&
      !e.shiftKey &&
      !e.altKey &&
      !e.ctrlKey &&
      !e.metaKey
    ) {
      e.preventDefault();
      onEditLast();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !isCoarsePointer() && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  }

  // Whatever came through "Vídeo" or "Arquivo": pictures still go to the
  // picture tray, everything else is uploaded as it is.
  function addAnything(files: File[]) {
    if (files.length === 0 || disabled || editing) return;
    if (!allow.images) {
      setError(t("groups.groupMessageComposer.youDoNotHavePermissionTo"));
      return;
    }
    const { images: pictures, others } = splitPicked(files, isSupportedChatImage);
    if (pictures.length > 0) void addImages(pictures);
    if (others.length > 0) void uploads.add(others);
  }

  // Ctrl+V of a picture — a screenshot, an image copied from a page — lands in
  // the tray exactly as if it had been picked with the button. Anything that
  // is not a picture (plain text, above all) is left to paste as usual.
  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    // An edit changes words only; a picture pasted into one has nowhere to go.
    if (editing) return;
    const files = Array.from(e.clipboardData?.items ?? [])
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    if (files.length === 0) return;
    e.preventDefault();
    void addImages(files);
  }

  async function addImages(files: File[]) {
    if (files.length === 0 || disabled || editing) return;
    if (!allow.images) {
      setError(t("groups.groupMessageComposer.youDoNotHavePermissionTo"));
      return;
    }
    const room = CHAT_IMAGE_MAX_PER_MESSAGE - images.length;
    if (room <= 0) {
      setError(t("groups.groupMessageComposer.atMostChatImageMaxPer", { CHAT_IMAGE_MAX_PER_MESSAGE }));
      return;
    }
    const next = [...images];
    for (const file of files.slice(0, room)) {
      if (!isSupportedChatImage(file)) {
        setError(t("common.unsupportedImageFormat"));
        continue;
      }
      try {
        const prepared = await prepareChatImage(file);
        const total = next.reduce((n, i) => n + i.bytes, 0) + prepared.byteLength;
        if (total > CHAT_IMAGE_TOTAL_MAX_BYTES) {
          setError(t("groups.groupMessageComposer.theImagesWentOverTheMaximum"));
          break;
        }
        next.push({ dataUrl: prepared.dataUrl, bytes: prepared.byteLength });
      } catch {
        setError(t("common.couldNotReadThatImage"));
      }
    }
    setImages(next);
    textRef.current?.focus();
  }

  return (
    <div data-composer className="relative shrink-0 border-t border-zinc-200 p-2 dark:border-zinc-800">
      {emoji.open && (
        <EmojiSuggestions
          matches={emoji.matches}
          highlight={emoji.highlight}
          onHighlight={emoji.setHighlight}
          onPick={emoji.pick}
          className="absolute bottom-full left-2 right-2 mb-1"
        />
      )}
      {mentionOpen && (
        <ul
          role="listbox"
          className="absolute bottom-full left-2 right-2 mb-1 max-h-60 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-800 dark:bg-zinc-950"
        >
          {suggestions.map((candidate, index) => (
            <li key={candidate.id}>
              <button
                type="button"
                role="option"
                aria-selected={index === highlight}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickMention(candidate);
                }}
                onMouseEnter={() => setHighlight(index)}
                className={`flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs ${
                  index === highlight
                    ? "bg-zinc-100 text-zinc-950 dark:bg-zinc-800 dark:text-zinc-50"
                    : "text-zinc-700 dark:text-zinc-300"
                }`}
              >
                {candidate.room ? (
                  <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center text-zinc-500">
                    {candidate.room === "voice" ? (
                      <MdVolumeUp className="h-3.5 w-3.5" />
                    ) : (
                      <span className="text-sm font-semibold leading-none">#</span>
                    )}
                  </span>
                ) : candidate.id === EVERYONE_MENTION ? (
                  <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-blue-600 text-white">
                    <MdGroups className="h-3 w-3" />
                  </span>
                ) : candidate.id === ONLINE_MENTION || candidate.id === OFFLINE_MENTION ? (
                  <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <span
                      className={`h-2 w-2 rounded-full ${candidate.id === ONLINE_MENTION ? "bg-emerald-500" : "bg-zinc-400"}`}
                    />
                  </span>
                ) : candidate.id === MENTION_BUILDER ? (
                  <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-violet-600 text-white">
                    <MdTune className="h-3 w-3" />
                  </span>
                ) : candidate.id.startsWith(ROLE_MENTION_PREFIX) ? (
                  <span
                    className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                    style={{ backgroundColor: candidate.color ?? "#5865f2" }}
                  >
                    @
                  </span>
                ) : (
                  <UserAvatar src={candidate.avatarUrl} name={candidate.name} size={18} />
                )}
                <span className="truncate" style={candidate.color ? { color: candidate.color } : undefined}>
                  {candidate.name}
                </span>
                {!isPerson(candidate) && !candidate.room && (
                  <span className="ml-auto shrink-0 text-[11px] text-zinc-400">
                    {candidate.id === EVERYONE_MENTION
                      ? t("groups.groupMessageComposer.hintEveryone")
                      : candidate.id === ONLINE_MENTION
                        ? t("groups.groupMessageComposer.hintOnline")
                        : candidate.id === OFFLINE_MENTION
                          ? t("groups.groupMessageComposer.hintOffline")
                          : candidate.id === MENTION_BUILDER
                            ? t("groups.groupMessageComposer.hintBuilder")
                            : t("groups.groupMessageComposer.hintRole")}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <div className="mb-1.5 flex items-center justify-between gap-2 rounded-lg bg-amber-50 px-2.5 py-1 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
          <span className="flex min-w-0 items-center gap-1.5">
            <MdEdit className="h-3.5 w-3.5 shrink-0" />
            <span className="shrink-0 font-medium">{t("groups.groupMessageComposer.editing")}</span>
            {/* Keys mean nothing on a phone's keyboard; the tick is how it saves there. */}
            {!isCoarsePointer() && (
              <span className="truncate text-amber-700/70 dark:text-amber-300/60">
                · {t("groups.groupMessageComposer.editHint")}
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={endEdit}
            aria-label={t("groups.groupMessageComposer.cancelEdit")}
            className="shrink-0 cursor-pointer rounded p-0.5 hover:bg-amber-100 dark:hover:bg-amber-500/20"
          >
            <MdClose className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {replyingTo && !editing && (
        <div className="mb-1.5 flex items-center justify-between gap-2 rounded-lg bg-zinc-100 px-2.5 py-1 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          <span className="min-w-0 truncate">
            {t("groups.groupMessageComposer.replying")} <span className="font-medium text-zinc-900 dark:text-zinc-100">@{replyingTo.name}</span>
            {replyingTo.text ? ` — ${replyingTo.text}` : ""}
          </span>
          <button
            type="button"
            onClick={onCancelReply}
            aria-label={t("common.cancelReply")}
            className="shrink-0 cursor-pointer rounded p-0.5 hover:bg-zinc-200 dark:hover:bg-zinc-800"
          >
            <MdClose className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {images.length > 0 && (
        <div className="mb-1.5 flex gap-2">
          {images.map((image, index) => (
            <div
              key={index}
              className="relative h-16 w-16 overflow-hidden rounded-lg border border-zinc-300 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.dataUrl} alt={t("common.attachment")} className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => setImages(images.filter((_, i) => i !== index))}
                aria-label={t("common.removeImage")}
                className="absolute right-0.5 top-0.5 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white"
              >
                <MdClose className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      {!editing && <AttachmentTray items={uploads.items} onRemove={uploads.remove} className="mb-1.5" />}

      <div className="flex items-end gap-1.5">
        {/* An edit changes the words only: nothing to attach, and a GIF
            picked here would go out as a new message. */}
        {allow.images && !editing && (
          <AttachMenu
            onImages={(files) => void addImages(files)}
            onFiles={addAnything}
            onOpen={() => void uploads.refreshLimit()}
            limitMb={uploads.limit?.maxMb}
            disabled={disabled}
            tooltip={disabledReason ?? undefined}
            wrapperClassName="flex shrink-0"
            buttonClassName={iconButton}
            iconClassName="h-6 w-6"
          />
        )}
        <HighlightedTextarea
          ref={textRef}
          value={text}
          highlights={highlights}
          wrapperClassName="min-w-0 flex-1"
          onChange={onChange}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onFocus={emoji.prefetch}
          onSelect={(e) => {
            setCursor(e.currentTarget.selectionStart ?? 0);
            emoji.sync();
          }}
          onClick={(e) => {
            setCursor(e.currentTarget.selectionStart ?? 0);
            emoji.sync();
          }}
          rows={1}
          disabled={disabled}
          placeholder={disabledReason ?? t("groups.groupMessageComposer.messageInChannelname", { channelName })}
          className="min-h-12 resize-none overflow-y-hidden rounded-lg border border-zinc-300 bg-white px-3 py-[11px] text-base leading-6 text-zinc-950 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-950/10 disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:ring-white/10"
        />
        {allow.gifs && !editing && (
        <Popover
          open={gifOpen}
          onClose={() => setGifOpen(false)}
          placement="top-start"
          content={
            <GifPicker
              onSelect={(gif) => {
                setGifOpen(false);
                send({ url: gif.url });
              }}
            />
          }
          tooltip={t("common.sendGif")}
        >
          <button
            type="button"
            onClick={() => setGifOpen((open) => !open)}
            disabled={disabled}
            aria-label={t("common.sendGif")}
            className={iconButton}
          >
            <MdGif className="h-6 w-6" />
          </button>
        </Popover>
        )}
        <EmojiPickerButton onPick={emoji.insert} disabled={disabled} className={iconButton} />
        <button
          type="button"
          onClick={() => send()}
          // An edit erased to nothing still goes: the room asks whether to delete.
          disabled={disabled || (!editing && !text.trim() && images.length === 0 && uploads.items.length === 0)}
          aria-label={editing ? t("common.save") : t("common.send")}
          className="mb-1 flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-zinc-950 text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
        >
          {editing ? <MdCheck className="h-5 w-5" /> : <MdSend className="h-4 w-4" />}
        </button>
      </div>
      {(error || uploads.error) && <p className="mt-1 px-1 text-xs text-red-500">{error || uploads.error}</p>}
    </div>
  );
}

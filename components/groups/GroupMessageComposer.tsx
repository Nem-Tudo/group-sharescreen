"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import { MdClose, MdGif, MdGroups, MdOutlineImage, MdSend, MdVolumeUp } from "react-icons/md";
import { EmojiPickerButton } from "@/components/EmojiPicker";
import { EmojiSuggestions } from "@/components/EmojiSuggestions";
import { GifPicker } from "@/components/GifPicker";
import { HighlightedTextarea, highlightMentions } from "@/components/HighlightedTextarea";
import { Popover, Tooltip } from "@/components/Tooltip";
import { UserAvatar } from "@/components/UserAvatar";
import {
  CHAT_IMAGE_ACCEPT,
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
import { EVERYONE_MENTION, ROLE_MENTION_PREFIX } from "@/lib/groupPermissions";
import { encodeMentions, userTokenIds, type Named } from "@/lib/messageTokens";
import { createTypingAnnouncer, type TypingAnnouncer } from "@/lib/typing";
import { useEmojiAutocomplete } from "@/lib/useEmojiAutocomplete";
import { useT } from "@/lib/useI18n";

// The box at the bottom of a group's text room. Drawn like the room chat's own
// composer (components/ChatPanel) — a text field and small icon buttons along
// the bottom edge of the panel — so writing in a group feels like writing in a
// room. Behaviour follows the DM composer, plus @mentions of the group's
// members, which the "só menções" notification level is built on.

export interface MentionCandidate {
  /** A member's id, EVERYONE_MENTION, ROLE_MENTION_PREFIX + a role's id, or a room's id. */
  id: string;
  name: string;
  avatarUrl: string | null;
  /** A role's colour, for its suggestion. */
  color?: string | null;
  /** Set on a room offered after "#": which kind, for its icon. */
  room?: "text" | "voice";
}

function isPerson(candidate: MentionCandidate): boolean {
  return (
    !candidate.room &&
    candidate.id !== EVERYONE_MENTION &&
    !candidate.id.startsWith(ROLE_MENTION_PREFIX)
  );
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
  mentions: string[];
}

const MAX_LENGTH = 2000;

const NO_CANDIDATES: MentionCandidate[] = [];
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

// Sized and nudged to sit centred on the text box's first line (48px tall),
// and to stay on its bottom edge as the box grows.
const iconButton =
  "mb-1 flex h-10 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-zinc-200";

export function GroupMessageComposer({
  channelName,
  candidates,
  rooms = [],
  searchPeople,
  replyingTo,
  onCancelReply,
  onSend,
  disabledReason,
  allow = { gifs: true, images: true },
  onTypingChange,
}: {
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
  const fileRef = useRef<HTMLInputElement | null>(null);

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

  const searchQuery = trigger.isTriggered && trigger.char === "@" ? trigger.query.trim() : "";
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

  const suggestions = useMemo(() => {
    if (!trigger.isTriggered) return NO_CANDIDATES;
    if (trigger.char === "#") return filterMentionCandidates(rooms, trigger.query).slice(0, 8);
    // Ranked together, so an exact match found by the search is not buried
    // under a looser one the room happened to know already.
    const known = new Set(candidates.map((c) => c.id));
    const pool = [...candidates, ...searched.filter((c) => !known.has(c.id))];
    return filterMentionCandidates(pool, trigger.query).slice(0, 8);
  }, [trigger.isTriggered, trigger.char, trigger.query, candidates, rooms, searched]);
  const mentionOpen =
    trigger.isTriggered && suggestions.length > 0 && mentionDismissed !== trigger.startIndex;

  // What lights up blue in the box: every name send would turn into a
  // mention — the people, roles and @everyone this room offers, anybody picked
  // or found by a search — and the rooms after "#".
  const peopleRegex = useMemo(
    () => buildMentionsRegex([...candidates.map((c) => c.name), ...extraNames]),
    [candidates, extraNames]
  );
  const roomRegex = useMemo(() => buildMentionsRegex(rooms.map((r) => r.name), "#"), [rooms]);
  const highlights = useMemo(
    () =>
      /[@#]/.test(text) ? highlightMentions(text, [peopleRegex, roomRegex]) : null,
    [text, peopleRegex, roomRegex]
  );
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
    if (isPerson(candidate)) picked.current.set(normalizeSearch(candidate.name), candidate);
    rememberNames([candidate.name]);
    const { newText, newCursorPos } = applyMentionInsertion(
      text,
      cursor,
      trigger.startIndex,
      candidate.name,
      trigger.char
    );
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

  function send(extra: { url?: string } = {}) {
    if (disabled) return;
    const trimmed = emoji.convert(text).trim();
    if (!trimmed && images.length === 0 && !extra.url) return;

    // What goes out carries ids, not names (see lib/messageTokens): "@Ana"
    // becomes <@her id> and "#geral" becomes <#its id>, and the API reads who
    // was mentioned off those. Roles and @everyone stay as typed and still
    // travel in `mentions`, matched against the roles this room already has.
    const special = candidates.filter((c) => !isPerson(c));
    const specialNames = new Set(special.map((c) => normalizeSearch(c.name)));
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
    const encoded = extra.url ? "" : encodeMentions(trimmed, people, rooms);
    // An id is longer than most names, so a message that fitted as typed can
    // outgrow the limit once encoded — and the API would cut it, splitting a
    // token in half. Better to say so than to send a broken mention.
    if (encoded.length > MAX_LENGTH) {
      setError(t("groups.groupMessageComposer.theMessageGotTooLongWith"));
      return;
    }
    setError(null);
    onSend({
      text: encoded,
      ...(extra.url ? { url: extra.url } : {}),
      ...(!extra.url && images.length > 0 ? { images: images.map((i) => i.dataUrl) } : {}),
      // The people are in the text now; they ride here too only so an API
      // from before the tokens still alerts them.
      mentions: extra.url ? [] : [...mentionedIds(trimmed, special), ...userTokenIds(encoded)],
    });
    picked.current.clear();
    // A GIF goes on its own and leaves whatever was being typed alone.
    if (!extra.url) {
      typingRef.current?.sent();
      setText("");
      setImages([]);
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
    if (e.key === "Escape" && replyingTo) {
      e.preventDefault();
      onCancelReply();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !isCoarsePointer() && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  }

  async function onPickFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    await addImages(files);
  }

  // Ctrl+V of a picture — a screenshot, an image copied from a page — lands in
  // the tray exactly as if it had been picked with the button. Anything that
  // is not a picture (plain text, above all) is left to paste as usual.
  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData?.items ?? [])
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    if (files.length === 0) return;
    e.preventDefault();
    void addImages(files);
  }

  async function addImages(files: File[]) {
    if (files.length === 0 || disabled) return;
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
                {candidate.id === EVERYONE_MENTION && (
                  <span className="ml-auto shrink-0 text-[11px] text-zinc-400">avisa todo mundo</span>
                )}
                {candidate.id.startsWith(ROLE_MENTION_PREFIX) && (
                  <span className="ml-auto shrink-0 text-[11px] text-zinc-400">avisa quem tem o cargo</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {replyingTo && (
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

      <div className="flex items-end gap-1.5">
        {allow.images && (
        <Tooltip content={disabledReason ?? t("common.sendImage")}>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={disabled}
            aria-label={t("common.sendImage")}
            className={iconButton}
          >
            <MdOutlineImage className="h-5 w-5" />
          </button>
        </Tooltip>
        )}
        <input ref={fileRef} type="file" accept={CHAT_IMAGE_ACCEPT} multiple hidden onChange={onPickFiles} />
        {allow.gifs && (
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
        <EmojiPickerButton onPick={emoji.insert} disabled={disabled} className={iconButton} />
        <button
          type="button"
          onClick={() => send()}
          disabled={disabled || (!text.trim() && images.length === 0)}
          aria-label={t("common.send")}
          className="mb-1 flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-zinc-950 text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
        >
          <MdSend className="h-4 w-4" />
        </button>
      </div>
      {error && <p className="mt-1 px-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}

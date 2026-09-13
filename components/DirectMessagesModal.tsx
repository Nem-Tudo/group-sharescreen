"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  MdArrowBack,
  MdCall,
  MdClose,
  MdErrorOutline,
  MdGif,
  MdImage,
  MdKeyboardArrowDown,
  MdReply,
  MdSchedule,
  MdSend,
} from "react-icons/md";
import { GifPicker } from "@/components/GifPicker";
import { Popover } from "@/components/Tooltip";
import { EmojiPickerButton } from "@/components/EmojiPicker";
import { EmojiSuggestions } from "@/components/EmojiSuggestions";
import { useEmojiAutocomplete } from "@/lib/useEmojiAutocomplete";
import { ChatImageModal, type ChatImagePreviewState } from "@/components/ChatImageModal";
import {
  CHAT_IMAGE_ACCEPT,
  CHAT_IMAGE_MAX_PER_MESSAGE,
  isSupportedChatImage,
  prepareChatImage,
} from "@/lib/chatImage";
import { DisplayUserName } from "@/components/DisplayUserName";
import { UserAvatar } from "@/components/UserAvatar";
import { useAuth } from "@/lib/AuthContext";
import { verifiedBadge } from "@/lib/entitlements";
import { openDirectMessages } from "@/lib/dmWindow";
import { startCall } from "@/lib/callsApi";
import { useSignalingSelector } from "@/lib/useSignalingSelector";
import { selectRecentDms } from "@/lib/signalingSelectors";
import { presenceLabel, usePresence } from "@/lib/presence";
import {
  fetchConversation,
  fetchConversations,
  markConversationRead,
  sendDirectMessage,
  type Conversation,
  type DirectMessage,
  type DmReplyTo,
} from "@/lib/dmApi";
import type { SocialUser } from "@/lib/socialApi";
import {
  createSendQueue,
  liveConversationList,
  mayHaveMore,
  newestFrom,
  threadMessages,
  unconfirmed,
  withConfirmed,
  withFreshPage,
  withOlderPage,
} from "@/lib/dmThread";
import { useT } from "@/lib/useI18n";
import { translate } from "@/lib/i18n";
import { formatLocale } from "@/lib/i18n";
import { usePageInFront } from "@/lib/pageFocus";

// Private messages, in a dialog.
//
// A dialog and not a page, for the reason the friend requests learned first:
// navigating out of a room ends the call (WatchRoom's unmount calls
// leaveRoom), and answering a message mid-conversation should not cost the
// conversation. Everything here therefore has to work stacked over whatever
// is behind it, including a live call.
//
// Two screens in one: the list of conversations, and one thread. `openWith`
// jumps straight to a thread — that is what a notification click does.
//
// What this version is built around, because each was a complaint:
//
//   - **A message is on screen the moment it is sent.** It used to appear only
//     when the socket echoed it back, which made every send feel like a round
//     trip to the database — because it was one. Now it is drawn at once as a
//     placeholder, swapped for the real message when either copy (the HTTP
//     response or the socket) lands, and matched by a label this tab gives it
//     (see `clientId` in lib/dmApi). Sends go out one at a time, in order, so
//     two quick messages cannot arrive swapped.
//   - **A failed send keeps what you wrote.** It stays in the thread, marked,
//     with "tentar de novo" — rather than the old behaviour of clearing the box
//     first and then reporting that it had not gone anywhere.
//   - **Only a deliberate click outside closes it.** Selecting text and letting
//     go past the edge used to count as a click on the backdrop, and so did
//     every click inside the enlarged picture, which was rendered inside it.
//   - **It does not fight you for the scroll position.** A new message only
//     pulls the thread down if you were already at the bottom; otherwise a
//     "novas mensagens" pill says it arrived. Scrolling to the top reads the
//     older history instead of stopping at the last fifty.

/** Two messages from one person this close together read as one thought. */
const GROUP_GAP_MS = 5 * 60 * 1000;
/** How close to the bottom still counts as "reading the newest line". */
const NEAR_BOTTOM_PX = 96;
/** How close to the top starts reading the page before. */
const NEAR_TOP_PX = 80;
const COMPOSER_MAX_HEIGHT_PX = 144;
const MAX_LENGTH = 2000;
const DAY_MS = 86_400_000;

// ─── A clock for the labels ─────────────────────────────────────────────
//
// "Hoje", "Ontem" and the list's times are relative to now, and reading the
// time during render is exactly what makes a render impure. So now is an
// external store instead: read once, and re-read once a minute, which is as
// often as any label on this screen can change.

let clockNow = 0;
function subscribeClock(onChange: () => void) {
  const timer = window.setInterval(() => {
    clockNow = Date.now();
    onChange();
  }, 60_000);
  return () => window.clearInterval(timer);
}
function getClock(): number {
  if (!clockNow) clockNow = Date.now();
  return clockNow;
}
function getClockServer(): number {
  return 0;
}

// ─── Labels ─────────────────────────────────────────────────────────────

function timeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString(formatLocale(), { hour: "2-digit", minute: "2-digit" });
}

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** The separator above the first message of each day. */
function dayLabel(ts: number, now: number): string {
  if (dayKey(ts) === dayKey(now)) return translate("common.today");
  if (dayKey(ts) === dayKey(now - DAY_MS)) return translate("common.yesterday");
  const label = new Date(ts).toLocaleDateString(formatLocale(), {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** The list's right-hand column: a time today, a word yesterday, a date after. */
function listTimeLabel(ts: number, now: number): string {
  if (dayKey(ts) === dayKey(now)) return timeLabel(ts);
  if (dayKey(ts) === dayKey(now - DAY_MS)) return translate("common.yesterday");
  return new Date(ts).toLocaleDateString(formatLocale(), { day: "2-digit", month: "2-digit" });
}

/**
 * What a message says in one line. A picture or a GIF has no text of its own,
 * and the old list drew an empty line under the name for both.
 */
function summary(message: Pick<DirectMessage, "text" | "kind" | "images">): string {
  if (message.text) return message.text;
  if (message.kind === "gif") return "GIF";
  const count = message.images?.length ?? 0;
  if (count > 1) return `${count} imagens`;
  if (count === 1 || message.kind === "image") return translate("common.image");
  return "";
}

const LINK_SPLIT = /(https?:\/\/[^\s]+|www\.[^\s]+)/g;
const LINK_TEST = /^(?:https?:\/\/|www\.)/;

/** Text with its links made clickable — the same rule the room chat follows. */
function linkify(text: string, mine: boolean): ReactNode[] {
  return text.split(LINK_SPLIT).map((part, index) => {
    if (!LINK_TEST.test(part)) return part;
    const href = part.startsWith("www.") ? `https://${part}` : part;
    return (
      <a
        key={index}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={`break-all underline underline-offset-2 ${
          mine ? "hover:opacity-80" : "hover:text-zinc-950 dark:hover:text-white"
        }`}
      >
        {part}
      </a>
    );
  });
}

/** A label for one outgoing message. Called on a press, never during render. */
function makeClientId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/** Phones send with the button; the Enter key there is a new line. */
function isCoarsePointer(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(pointer: coarse)").matches);
}

// ─── Types ──────────────────────────────────────────────────────────────

type Outgoing = {
  text: string;
  url?: string;
  images?: string[];
  replyTo: DmReplyTo | null;
};

/** A message this tab has written and the server has not yet confirmed. */
type Pending = {
  clientId: string;
  to: string;
  ts: number;
  payload: Outgoing;
  status: "sending" | "failed";
  error?: string;
};

type Thread = {
  userId: string;
  user: SocialUser;
  messages: DirectMessage[];
  hasMore: boolean;
};

/**
 * A value that belongs to one thread. Tagging is what lets a reply, a set of
 * attachments or an error stay with the conversation it was made in — switch
 * threads and it is simply not shown, switch back and it is still there —
 * without an effect having to clear anything.
 */
type Tagged<T> = { userId: string; value: T };

/** Everything a bubble needs, whether delivered or still on its way. */
type Bubble = {
  key: string;
  mine: boolean;
  text: string;
  kind?: DirectMessage["kind"];
  url?: string;
  images?: string[];
  replyTo?: DmReplyTo | null;
  ts: number;
  status?: Pending["status"];
  error?: string;
  /** What "responder" quotes. Only a delivered message can be answered. */
  replyTarget?: DmReplyTo;
  clientId?: string;
};

// ─── Pieces ─────────────────────────────────────────────────────────────

function ReplyButton({ target, onReply }: { target: DmReplyTo; onReply: (r: DmReplyTo) => void }) {
  const t = useT();
  return (
    <button
      type="button"
      aria-label={t("common.reply")}
      title={t("common.reply")}
      onClick={() => onReply(target)}
      className="shrink-0 self-center rounded-full p-1.5 text-zinc-400 opacity-100 transition hover:bg-zinc-100 hover:text-zinc-700 focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
    >
      <MdReply className="h-4 w-4" />
    </button>
  );
}

function MessageBubble({
  bubble,
  grouped,
  onReply,
  onOpenImage,
  onRetry,
  onDiscard,
  onMediaLoad,
}: {
  bubble: Bubble;
  grouped: boolean;
  onReply: (reply: DmReplyTo) => void;
  onOpenImage: (images: string[], index: number, alt: string) => void;
  onRetry: (clientId: string) => void;
  onDiscard: (clientId: string) => void;
  onMediaLoad: () => void;
}) {
  const t = useT();
  const { mine, status } = bubble;
  const failed = status === "failed";
  const images = bubble.images ?? [];

  return (
    <li
      className={`group flex items-end gap-1 ${mine ? "justify-end" : "justify-start"} ${
        grouped ? "mt-0.5" : "mt-2.5"
      }`}
    >
      {mine && bubble.replyTarget && <ReplyButton target={bubble.replyTarget} onReply={onReply} />}
      <div className={`flex max-w-[82%] flex-col ${mine ? "items-end" : "items-start"}`}>
        <div
          className={`rounded-2xl px-3 py-1.5 text-sm transition ${
            mine
              ? `bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950 ${grouped ? "rounded-tr-md" : ""}`
              : `bg-zinc-100 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100 ${grouped ? "rounded-tl-md" : ""}`
          } ${status === "sending" ? "opacity-70" : ""} ${
            failed ? "ring-2 ring-red-500/70" : ""
          }`}
        >
          {bubble.replyTo && (
            // A snapshot taken when the reply was sent, not a pointer (see the
            // API side). It keeps saying what it said even when the original
            // is far outside the loaded page.
            <span
              className={`mb-1 block border-l-2 pl-2 text-xs opacity-75 ${
                mine ? "border-white/40 dark:border-zinc-950/30" : "border-zinc-400"
              }`}
            >
              <span className="block font-medium">@{bubble.replyTo.name}</span>
              <span className="line-clamp-2 break-words">
                {bubble.replyTo.text || (bubble.replyTo.kind === "gif" ? "GIF" : t("common.image"))}
              </span>
            </span>
          )}
          {bubble.kind === "gif" && bubble.url && (
            <button
              type="button"
              onClick={() => onOpenImage([bubble.url!], 0, "GIF")}
              aria-label={t("common.enlargeTheGif")}
              className="-mx-1 mb-1 block cursor-zoom-in rounded-lg text-left transition hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={bubble.url}
                alt="GIF"
                onLoad={onMediaLoad}
                className="max-h-56 rounded-lg"
              />
            </button>
          )}
          {images.length > 0 && (
            <span
              className={`-mx-1 mb-1 grid gap-1 ${images.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}
            >
              {images.map((url, index) => (
                <button
                  key={`${index}:${url.slice(-24)}`}
                  type="button"
                  onClick={() => onOpenImage(images, index, t("common.image"))}
                  aria-label={t("common.enlargeTheImage")}
                  className="block cursor-zoom-in overflow-hidden rounded-lg text-left transition hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt={t("common.image")}
                    onLoad={onMediaLoad}
                    className={`w-full rounded-lg object-cover ${
                      images.length > 1 ? "aspect-square" : "max-h-64 object-contain"
                    }`}
                  />
                </button>
              ))}
            </span>
          )}
          {bubble.text && (
            <span className="whitespace-pre-wrap break-words">{linkify(bubble.text, mine)}</span>
          )}
          <span
            className={`mt-0.5 flex items-center justify-end gap-1 text-[10px] leading-none ${
              mine ? "text-white/60 dark:text-zinc-950/60" : "text-zinc-400"
            }`}
          >
            {status === "sending" && <MdSchedule className="h-3 w-3" aria-label={t("directMessagesModal.sending")} />}
            {timeLabel(bubble.ts)}
          </span>
        </div>
        {failed && bubble.clientId && (
          // Said under the bubble, in words, with the two things that can be
          // done about it. What was written is never thrown away on its own.
          <span className="mt-1 flex flex-wrap items-center justify-end gap-x-2 text-[11px] text-red-600 dark:text-red-400">
            <span className="flex items-center gap-1">
              <MdErrorOutline className="h-3.5 w-3.5 shrink-0" />
              {bubble.error ?? t("common.notSent")}
            </span>
            <button
              type="button"
              onClick={() => onRetry(bubble.clientId!)}
              className="font-semibold underline underline-offset-2"
            >
              {t("common.tryAgain2")}
            </button>
            <button
              type="button"
              onClick={() => onDiscard(bubble.clientId!)}
              className="text-zinc-500 underline underline-offset-2 dark:text-zinc-400"
            >
              {t("common.discard")}
            </button>
          </span>
        )}
      </div>
      {!mine && bubble.replyTarget && <ReplyButton target={bubble.replyTarget} onReply={onReply} />}
    </li>
  );
}

function ListSkeleton() {
  return (
    <ul className="flex flex-col gap-1 p-2" aria-hidden>
      {[0, 1, 2, 3].map((row) => (
        <li key={row} className="flex items-center gap-3 rounded-xl px-2 py-2.5">
          <span className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
          <span className="flex flex-1 flex-col gap-1.5">
            <span className="h-3 w-1/3 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
            <span className="h-2.5 w-2/3 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
          </span>
        </li>
      ))}
    </ul>
  );
}

function ThreadSkeleton() {
  return (
    <div className="flex flex-col gap-3 px-3 py-4" aria-hidden>
      {["w-1/2", "ml-auto w-2/5", "w-3/5", "ml-auto w-1/3"].map((width, index) => (
        <span
          key={index}
          className={`h-8 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-900 ${width}`}
        />
      ))}
    </div>
  );
}

// ─── The dialog ─────────────────────────────────────────────────────────

export function DirectMessagesModal({
  open,
  onClose,
  openWith,
}: {
  open: boolean;
  onClose: () => void;
  /**
   * Which thread is open, or null for the conversation list. Owned by the
   * store rather than by this component (see lib/dmWindow.ts): navigating
   * inside the dialog writes it back there, so there is one answer to "which
   * thread is open" instead of two that can disagree.
   */
  openWith?: string | null;
}) {
  const t = useT();
  const { account } = useAuth();
  const recentDms = useSignalingSelector(selectRecentDms);
  const now = useSyncExternalStore(subscribeClock, getClock, getClockServer);
  const pageInFront = usePageInFront();

  // null until the first answer, so "loading" and "no conversations" are two
  // different screens instead of one that lies for a second.
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [listFailed, setListFailed] = useState(false);
  const [listSeq, setListSeq] = useState(0);
  // The loaded thread, tagged with whose it is — a thread whose userId does
  // not match the one being asked for is simply stale, and renders as loading
  // rather than having to be cleared by an effect.
  const [thread, setThread] = useState<Thread | null>(null);
  const [threadFailed, setThreadFailed] = useState<string | null>(null);
  const [threadSeq, setThreadSeq] = useState(0);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  // One draft per conversation. Switching threads used to carry what was
  // typed for one person into the box of another.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [reply, setReply] = useState<Tagged<DmReplyTo> | null>(null);
  const [attachments, setAttachments] = useState<Tagged<string[]> | null>(null);
  const [error, setError] = useState<Tagged<string> | null>(null);
  const [gifOpen, setGifOpen] = useState(false);
  const [imageModalPreview, setImageModalPreview] = useState<ChatImagePreviewState | null>(null);
  // Where the reader is in the thread, tagged like everything else so a thread
  // that has just opened starts out "at the bottom" without an effect.
  const [scroll, setScroll] = useState<{ userId: string; atBottom: boolean; seen: string | null } | null>(
    null
  );
  // Every send joins this, so they reach the server in the order written —
  // see createSendQueue. Made once, for the life of the dialog.
  const [enqueueSend] = useState(createSendQueue);

  const fileRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  // Whether the press that became this click began on the backdrop itself.
  const pressedBackdropRef = useRef(false);
  const olderInFlightRef = useRef(false);
  const lastMarkedRef = useRef<string | null>(null);
  const focusedForRef = useRef<string | null>(null);
  const scrollMemoRef = useRef<{
    threadId: string | null;
    firstKey: string | null;
    lastKey: string | null;
    height: number;
  }>({ threadId: null, firstKey: null, lastKey: null, height: 0 });

  const activeId = openWith ?? null;
  const loaded = thread?.userId === activeId ? thread : null;
  // The name comes from the list when the thread has not arrived yet, so the
  // header is right on the first frame instead of saying "Carregando…".
  const active: SocialUser | null =
    loaded?.user ?? conversations?.find((c) => c.user.id === activeId)?.user ?? null;
  const presence = usePresence(activeId);

  const draft = activeId ? drafts[activeId] ?? "" : "";
  const replyingTo = reply && reply.userId === activeId ? reply.value : null;
  const attached = attachments && attachments.userId === activeId ? attachments.value : [];
  const shownError = error && error.userId === (activeId ?? "") ? error.value : null;

  // ":" for emoji, ":sob:" → 😭, and the picker beside "send" — see
  // useEmojiAutocomplete. It writes into this conversation's draft.
  const emoji = useEmojiAutocomplete({
    textareaRef: composerRef,
    onReplace: (value) => {
      if (!activeId) return;
      setDrafts((current) => ({ ...current, [activeId]: value.slice(0, MAX_LENGTH) }));
    },
  });

  // The fetched page, plus anything that arrived since — derived rather than
  // merged into state, so a message landing while this is open needs no effect
  // and cannot be lost between two renders. See lib/dmThread for the rules.
  const messages = useMemo(
    () =>
      loaded && account && activeId
        ? threadMessages(loaded.messages, recentDms, account.id, activeId)
        : [],
    [loaded, recentDms, activeId, account]
  );
  const outgoing = useMemo(
    () => unconfirmed(pending, messages, activeId),
    [pending, messages, activeId]
  );
  const newestIncomingId = newestFrom(messages, activeId);

  const atBottom = scroll?.userId === activeId ? scroll.atBottom : true;
  const seenIncoming = scroll?.userId === activeId ? scroll.seen : newestIncomingId;
  const showNewPill = !atBottom && newestIncomingId !== null && newestIncomingId !== seenIncoming;

  // The list, with anything that arrived since it was read laid over it: the
  // newest line and the order update the moment a message lands, and the
  // unread counts are left to the re-read below (which is what knows what has
  // been read on another device).
  const liveConversations = useMemo(
    () =>
      conversations && account
        ? liveConversationList(conversations, recentDms, account.id)
        : conversations,
    [conversations, recentDms, account]
  );

  // ── Effects ─────────────────────────────────────────────────────────

  // Escape undoes one thing at a time: the picker or the picture (which close
  // themselves on the same key), then the reply being written, then the
  // thread, and only then the dialog.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (gifOpen || imageModalPreview) return;
      if (replyingTo) {
        setReply(null);
        return;
      }
      setScroll(null);
      if (activeId) openDirectMessages(null);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, activeId, onClose, gifOpen, imageModalPreview, replyingTo]);

  // The page behind stays put. Scrolling a conversation to its end and
  // carrying on into the room's chat underneath is the kind of thing that
  // makes a dialog feel like it is not really there.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // The list — only while it is the screen being looked at. It used to be
  // re-read on *every* message, including while a thread was open and nobody
  // could see it; that was a pair of aggregations on the server per message
  // received. Debounced, so a burst is one read.
  useEffect(() => {
    if (!open || !account || activeId) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetchConversations(controller.signal).then((data) => {
        if (controller.signal.aborted) return;
        if (data) {
          setConversations(data.conversations);
          setListFailed(false);
        } else {
          setListFailed(true);
        }
      });
    }, 120);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, account, activeId, recentDms, listSeq]);

  // Whichever thread the store is pointing at. What was already on screen for
  // it stays there while the fresh page loads, and anything newer than that
  // page — a message sent while it was in flight — is carried over rather than
  // dropped by the replace.
  useEffect(() => {
    if (!open || !activeId) return;
    const controller = new AbortController();
    void fetchConversation(activeId, undefined, controller.signal).then((data) => {
      if (controller.signal.aborted) return;
      if (!data) {
        setThreadFailed(activeId);
        return;
      }
      setThreadFailed(null);
      setThread((previous) => ({
        userId: activeId,
        user: data.user,
        messages: withFreshPage(previous?.userId === activeId ? previous.messages : null, data.messages),
        hasMore: mayHaveMore(data.messages),
      }));
    });
    return () => controller.abort();
  }, [open, activeId, threadSeq]);

  // The bookmark, moved once per message that arrives in the open thread —
  // not once per message arriving anywhere, which is what re-running on every
  // socket delivery used to do. And only while the page is in front: a thread
  // left open behind another window has not been read, so its unread count
  // and notification stand until somebody comes back to it.
  useEffect(() => {
    if (!open || !activeId || !loaded || !pageInFront) return;
    const key = `${activeId}:${newestIncomingId ?? ""}`;
    if (lastMarkedRef.current === key) return;
    lastMarkedRef.current = key;
    markConversationRead(activeId);
  }, [open, activeId, loaded, newestIncomingId, pageInFront]);

  // The box is ready to type in as soon as a thread is. Not on phones: that
  // would throw the keyboard over the conversation somebody opened to read.
  useEffect(() => {
    if (!open) {
      focusedForRef.current = null;
      return;
    }
    if (!activeId || !loaded || focusedForRef.current === activeId) return;
    focusedForRef.current = activeId;
    if (!isCoarsePointer()) composerRef.current?.focus({ preventScroll: true });
  }, [open, activeId, loaded]);

  // The composer grows with what is typed, up to a few lines.
  useLayoutEffect(() => {
    const node = composerRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, COMPOSER_MAX_HEIGHT_PX)}px`;
  }, [draft, activeId, open]);

  // Where the thread's scroll ends up after it changes. Before paint, so the
  // reader never sees the jump.
  const firstKey = messages[0]?.id ?? null;
  const lastKey =
    outgoing.length > 0
      ? outgoing[outgoing.length - 1].clientId
      : messages[messages.length - 1]?.id ?? null;
  const lastIsMine =
    outgoing.length > 0 || (messages.length > 0 && messages[messages.length - 1].from === account?.id);

  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node || !loaded) {
      // No box on screen — the list is showing, or the dialog is closed. The
      // next box is a new element starting at the top, so whatever thread
      // comes back has to be treated as just opened. Without this, going to
      // the list and back into the same conversation left it at its oldest
      // line, because the memory still said that thread was already placed.
      scrollMemoRef.current = { ...scrollMemoRef.current, threadId: null };
      return;
    }
    const memo = scrollMemoRef.current;
    if (memo.threadId !== activeId) {
      // A thread that just opened starts at its newest line.
      node.scrollTop = node.scrollHeight;
    } else if (firstKey !== memo.firstKey && lastKey === memo.lastKey) {
      // An older page went in above. Keep the line the reader was on exactly
      // where it was, rather than letting the new history shove it down.
      node.scrollTop += node.scrollHeight - memo.height;
    } else if (lastKey !== memo.lastKey && (atBottom || lastIsMine)) {
      // Something new at the end. Followed only if the reader was already
      // there, or if it is theirs — otherwise the pill says it arrived.
      node.scrollTop = node.scrollHeight;
    }
    scrollMemoRef.current = { threadId: activeId, firstKey, lastKey, height: node.scrollHeight };
  }, [activeId, loaded, firstKey, lastKey, lastIsMine, atBottom]);

  if (!open) return null;

  // ── Sending ─────────────────────────────────────────────────────────

  async function deliver(entry: Pending) {
    const result = await sendDirectMessage(entry.to, { ...entry.payload, clientId: entry.clientId });
    if (result.ok) {
      // Into the thread directly as well, so the message is there even if the
      // socket copy never comes — a dropped connection is exactly when that
      // happens, and a message that vanished on send is the worst outcome.
      setThread((current) =>
        current && current.userId === entry.to
          ? { ...current, messages: withConfirmed(current.messages, result.message) }
          : current
      );
      setPending((current) => current.filter((p) => p.clientId !== entry.clientId));
    } else {
      setPending((current) =>
        current.map((p) =>
          p.clientId === entry.clientId ? { ...p, status: "failed", error: result.error } : p
        )
      );
    }
  }

  /** Joins the queue: drawn now, sent after whatever was written before it. */
  function enqueue(entry: Pending) {
    void enqueueSend(() => deliver(entry));
  }

  function send(to: string, payload: Outgoing) {
    const entry: Pending = {
      clientId: makeClientId(),
      to,
      ts: Date.now(),
      payload,
      status: "sending",
    };
    setPending((current) => [...current, entry]);
    enqueue(entry);
  }

  function retry(clientId: string) {
    const entry = pending.find((p) => p.clientId === clientId);
    if (!entry) return;
    const again: Pending = { ...entry, status: "sending", error: undefined };
    setPending((current) => current.map((p) => (p.clientId === clientId ? again : p)));
    enqueue(again);
  }

  function discard(clientId: string) {
    setPending((current) => current.filter((p) => p.clientId !== clientId));
  }

  function submit() {
    if (!activeId) return;
    const text = emoji.convert(draft).trim();
    if (!text && attached.length === 0) return;
    send(activeId, {
      text,
      ...(attached.length > 0 ? { images: attached } : {}),
      replyTo: replyingTo,
    });
    setDrafts((current) => ({ ...current, [activeId]: "" }));
    setAttachments(null);
    setReply(null);
    setError(null);
    composerRef.current?.focus({ preventScroll: true });
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    submit();
  }

  function handleComposerKey(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (emoji.handleKeyDown(event)) return;
    // Enter sends, Shift+Enter is a new line — except while an input method is
    // still composing a character, where Enter is how the character is chosen.
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    if (isCoarsePointer()) return;
    event.preventDefault();
    submit();
  }

  async function handleFiles(files: FileList | null) {
    const to = activeId;
    if (!to || !files || files.length === 0) return;
    setError(null);
    const room = CHAT_IMAGE_MAX_PER_MESSAGE - attached.length;
    const picked = [...files].slice(0, Math.max(0, room));
    const prepared: string[] = [];
    for (const file of picked) {
      if (!isSupportedChatImage(file)) {
        setError({ userId: to, value: t("common.unsupportedImageFormat") });
        continue;
      }
      try {
        // The same downscale the room chat runs before sending, so a phone
        // photo does not cross the wire at its original size.
        const image = await prepareChatImage(file);
        prepared.push(image.dataUrl);
      } catch {
        setError({ userId: to, value: t("directMessagesModal.couldNotPrepareTheImage") });
      }
    }
    if (prepared.length === 0) return;
    // Tagged to the thread they were picked for, even if somebody switched
    // conversations while the pictures were being prepared.
    setAttachments((current) => ({
      userId: to,
      value: [...(current?.userId === to ? current.value : []), ...prepared].slice(
        0,
        CHAT_IMAGE_MAX_PER_MESSAGE
      ),
    }));
  }

  // ── Scrolling ───────────────────────────────────────────────────────

  async function loadOlder() {
    if (!activeId || !loaded || !loaded.hasMore || olderInFlightRef.current) return;
    const oldest = loaded.messages[0];
    if (!oldest) return;
    olderInFlightRef.current = true;
    setLoadingOlder(true);
    const data = await fetchConversation(activeId, oldest.ts);
    olderInFlightRef.current = false;
    setLoadingOlder(false);
    if (!data) return;
    setThread((current) =>
      current && current.userId === activeId
        ? {
            ...current,
            messages: withOlderPage(current.messages, data.messages),
            hasMore: mayHaveMore(data.messages),
          }
        : current
    );
  }

  function handleScroll() {
    const node = scrollRef.current;
    if (!node || !activeId) return;
    const bottom = node.scrollHeight - node.scrollTop - node.clientHeight < NEAR_BOTTOM_PX;
    setScroll((current) => {
      const seen = bottom
        ? newestIncomingId
        : current?.userId === activeId
          ? current.seen
          : newestIncomingId;
      if (current && current.userId === activeId && current.atBottom === bottom && current.seen === seen) {
        return current;
      }
      return { userId: activeId, atBottom: bottom, seen };
    });
    if (node.scrollTop < NEAR_TOP_PX) void loadOlder();
  }

  function jumpToNewest() {
    const node = scrollRef.current;
    if (node) node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }

  // A picture that finishes loading after the thread was drawn makes it
  // taller. If the reader was at the bottom, they stay there.
  function handleMediaLoad() {
    const node = scrollRef.current;
    if (!node) return;
    if (atBottom) node.scrollTop = node.scrollHeight;
    scrollMemoRef.current = { ...scrollMemoRef.current, height: node.scrollHeight };
  }

  // ── Leaving ─────────────────────────────────────────────────────────

  // Both ways out of a thread forget the reader's place in it, so coming back
  // starts at the newest line with no stale "novas mensagens" pill.
  function backToList() {
    setScroll(null);
    openDirectMessages(null);
  }
  function close() {
    setScroll(null);
    onClose();
  }

  // Only a press that both began and ended on the backdrop closes. A plain
  // onClick on it also fired for a text selection that started in a message
  // and was released past the dialog's edge — the browser reports that click
  // on the nearest common ancestor, which is the backdrop.
  function handleBackdropPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    pressedBackdropRef.current = event.target === event.currentTarget;
  }
  function handleBackdropClick(event: ReactMouseEvent<HTMLDivElement>) {
    const began = pressedBackdropRef.current;
    pressedBackdropRef.current = false;
    if (began && event.target === event.currentTarget) close();
  }

  // ── Rendering ───────────────────────────────────────────────────────

  const bubbles: Bubble[] = [
    ...messages.map((message): Bubble => {
      const mine = message.from === account?.id;
      return {
        // The client label when there is one, so the placeholder and the real
        // message are the same element and nothing flickers on the swap.
        key: message.clientId ?? message.id,
        mine,
        text: message.text,
        kind: message.kind,
        url: message.url,
        images: message.images,
        replyTo: message.replyTo,
        ts: message.ts,
        replyTarget: {
          id: message.id,
          name: mine ? t("common.you") : active?.displayName ?? "",
          // Snapshotted from what is on screen. The API re-validates every
          // field before storing (see parseDmReplyTo).
          ...(message.text ? { text: message.text } : {}),
          ...(message.kind ? { kind: message.kind } : {}),
          ...(message.images ? { images: message.images } : {}),
        },
      };
    }),
    ...outgoing.map(
      (entry): Bubble => ({
        key: entry.clientId,
        clientId: entry.clientId,
        mine: true,
        text: entry.payload.text,
        kind: entry.payload.url ? "gif" : entry.payload.images?.length ? "image" : "text",
        url: entry.payload.url,
        images: entry.payload.images,
        replyTo: entry.payload.replyTo,
        ts: entry.ts,
        status: entry.status,
        error: entry.error,
      })
    ),
  ];

  const threadItems: ReactNode[] = [];
  bubbles.forEach((bubble, index) => {
    const previous = bubbles[index - 1];
    const newDay = !previous || dayKey(previous.ts) !== dayKey(bubble.ts);
    if (newDay) {
      threadItems.push(
        <li key={`day:${dayKey(bubble.ts)}`} className="mb-1 mt-4 flex justify-center first:mt-0">
          <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-[11px] font-medium text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
            {dayLabel(bubble.ts, now)}
          </span>
        </li>
      );
    }
    const grouped =
      !newDay && previous.mine === bubble.mine && bubble.ts - previous.ts < GROUP_GAP_MS;
    threadItems.push(
      <MessageBubble
        key={bubble.key}
        bubble={bubble}
        grouped={grouped}
        onReply={(target) => {
          if (!activeId) return;
          setReply({ userId: activeId, value: target });
          // Straight into the box, so the next key is the answer. Every
          // pointer, unlike opening a thread: answering *is* asking to type.
          requestAnimationFrame(() => composerRef.current?.focus({ preventScroll: true }));
        }}
        onOpenImage={(images, index, alt) =>
          setImageModalPreview({ src: images[index], alt, images, currentIndex: index })
        }
        onRetry={retry}
        onDiscard={discard}
        onMediaLoad={handleMediaLoad}
      />
    );
  });

  const canSend = draft.trim().length > 0 || attached.length > 0;
  const iconButton =
    "shrink-0 rounded-full p-2 text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-950 disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50";

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/50 sm:items-center sm:p-4"
        onPointerDown={handleBackdropPointerDown}
        onClick={handleBackdropClick}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={active ? t("directMessagesModal.conversationWithDisplayname", { displayName: active.displayName }) : t("common.messages")}
          // Full screen on a phone, where a floating card is mostly margin and
          // the keyboard would cover half of it; a card from `sm` up.
          className="flex h-dvh w-full flex-col overflow-hidden bg-white shadow-2xl sm:h-[min(44rem,88dvh)] sm:max-w-lg sm:rounded-2xl sm:border sm:border-black/10 dark:bg-zinc-950 sm:dark:border-white/10"
        >
          {/* ── Header ── */}
          <div className="flex shrink-0 items-center gap-2 border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
            {activeId && (
              <button
                type="button"
                onClick={backToList}
                aria-label={t("directMessagesModal.backToTheConversations")}
                title={t("common.back")}
                className="rounded-full p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
              >
                <MdArrowBack className="h-5 w-5" />
              </button>
            )}
            {activeId && active ? (
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <UserAvatar
                  src={active.avatarUrl}
                  name={active.displayName}
                  size={34}
                  userId={active.id}
                  className="shrink-0"
                />
                <div className="min-w-0">
                  <DisplayUserName
                    name={active.displayName}
                    verified={verifiedBadge(active.flags)}
                    bot={active.bot}
                    color={active.nameColor ?? null}
                    className="block truncate text-sm font-semibold text-zinc-950 dark:text-zinc-50"
                  />
                  <span className="block truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                    {presence ? presenceLabel(presence) : `@${active.username}`}
                  </span>
                </div>
              </div>
            ) : (
              <h2 className="flex-1 truncate px-1 text-base font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                {activeId ? t("common.loading") : t("common.messages")}
              </h2>
            )}
            {/* Only inside a thread, and only once we know who it is with.
                The window stays open on purpose — the ringing screen (see
                components/CallHost) draws above it, and closing this would
                throw away the conversation the call came out of. */}
            {activeId && active && (
              <button
                type="button"
                onClick={() => void startCall(activeId)}
                aria-label={t("common.callDisplayname", { displayName: active.displayName })}
                title={t("common.callDisplayname", { displayName: active.displayName })}
                className="rounded-full p-1.5 text-emerald-600 transition hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
              >
                <MdCall className="h-5 w-5" />
              </button>
            )}
            <button
              type="button"
              onClick={close}
              aria-label={t("common.close")}
              title={t("common.close")}
              className="rounded-full p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
            >
              <MdClose className="h-5 w-5" />
            </button>
          </div>

          {!activeId ? (
            // ── The list ──
            <div className="flex-1 overflow-y-auto overscroll-contain">
              {liveConversations === null ? (
                listFailed ? (
                  <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                      {t("directMessagesModal.couldNotLoadTheConversations")}
                    </p>
                    <button
                      type="button"
                      onClick={() => setListSeq((n) => n + 1)}
                      className="text-sm font-medium text-zinc-900 underline underline-offset-2 dark:text-zinc-100"
                    >
                      {t("common.tryAgain2")}
                    </button>
                  </div>
                ) : (
                  <ListSkeleton />
                )
              ) : liveConversations.length === 0 ? (
                <p className="px-6 py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  {t("directMessagesModal.noConversationYetOpenSomeoneS")}
                </p>
              ) : (
                <ul className="flex flex-col gap-0.5 p-2">
                  {liveConversations.map((conversation) => {
                    const { user, lastMessage, unread } = conversation;
                    const mine = lastMessage.from === account?.id;
                    const line = summary(lastMessage);
                    return (
                      <li key={user.id}>
                        <button
                          type="button"
                          onClick={() => openDirectMessages(user.id)}
                          className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
                        >
                          <UserAvatar
                            src={user.avatarUrl}
                            name={user.displayName}
                            size={40}
                            userId={user.id}
                            className="shrink-0"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline gap-2">
                              <DisplayUserName
                                name={user.displayName}
                                verified={verifiedBadge(user.flags)}
                                bot={user.bot}
                                color={user.nameColor ?? null}
                                className={`min-w-0 flex-1 truncate text-sm text-zinc-900 dark:text-zinc-100 ${
                                  unread > 0 ? "font-semibold" : "font-medium"
                                }`}
                              />
                              <span
                                className={`shrink-0 text-[11px] ${
                                  unread > 0
                                    ? "font-semibold text-emerald-600 dark:text-emerald-400"
                                    : "text-zinc-400"
                                }`}
                              >
                                {listTimeLabel(lastMessage.ts, now)}
                              </span>
                            </span>
                            <span className="mt-0.5 flex items-center gap-2">
                              <span
                                className={`min-w-0 flex-1 truncate text-xs ${
                                  unread > 0
                                    ? "font-medium text-zinc-800 dark:text-zinc-200"
                                    : "text-zinc-500 dark:text-zinc-400"
                                }`}
                              >
                                {mine ? t("directMessagesModal.youLine", { line }) : line}
                              </span>
                              {unread > 0 && (
                                <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 px-1.5 text-[11px] font-semibold text-white">
                                  {unread > 99 ? "99+" : unread}
                                </span>
                              )}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : (
            // ── One thread ──
            <>
              <div className="relative min-h-0 flex-1">
                <div
                  ref={scrollRef}
                  onScroll={handleScroll}
                  // Anchoring off: this component keeps the reading position
                  // itself when history goes in above, and the browser doing
                  // it too would move the line twice.
                  className="h-full overflow-y-auto overscroll-contain px-3 py-3 [overflow-anchor:none]"
                >
                  {!loaded ? (
                    threadFailed === activeId ? (
                      <div className="flex flex-col items-center gap-2 py-12 text-center">
                        <p className="text-sm text-zinc-500 dark:text-zinc-400">
                          {t("directMessagesModal.couldNotOpenTheConversation")}
                        </p>
                        <button
                          type="button"
                          onClick={() => setThreadSeq((n) => n + 1)}
                          className="text-sm font-medium text-zinc-900 underline underline-offset-2 dark:text-zinc-100"
                        >
                          {t("common.tryAgain2")}
                        </button>
                      </div>
                    ) : (
                      <ThreadSkeleton />
                    )
                  ) : bubbles.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                      {active && (
                        <UserAvatar
                          src={active.avatarUrl}
                          name={active.displayName}
                          size={64}
                          userId={active.id}
                        />
                      )}
                      <p className="text-sm text-zinc-500 dark:text-zinc-400">
                        {t("directMessagesModal.sayHiTo")} {active?.displayName ?? "essa pessoa"}.
                      </p>
                    </div>
                  ) : (
                    <>
                      {(loaded.hasMore || loadingOlder) && (
                        <div className="flex justify-center pb-2">
                          <button
                            type="button"
                            onClick={() => void loadOlder()}
                            disabled={loadingOlder}
                            className="rounded-full px-3 py-1 text-xs font-medium text-zinc-500 transition hover:bg-zinc-100 disabled:opacity-60 dark:text-zinc-400 dark:hover:bg-zinc-900"
                          >
                            {loadingOlder ? t("common.loading") : t("directMessagesModal.loadEarlierMessages")}
                          </button>
                        </div>
                      )}
                      <ul className="flex flex-col">{threadItems}</ul>
                    </>
                  )}
                </div>
                {showNewPill && (
                  <button
                    type="button"
                    onClick={jumpToNewest}
                    className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-zinc-950 px-3 py-1.5 text-xs font-medium text-white shadow-lg transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
                  >
                    <MdKeyboardArrowDown className="h-4 w-4" />
                    {t("directMessagesModal.newMessages")}
                  </button>
                )}
              </div>

              {replyingTo && (
                <div className="flex shrink-0 items-center gap-2 border-t border-zinc-200 bg-zinc-50 px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-900/50">
                  <MdReply className="h-4 w-4 shrink-0 text-zinc-500" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-zinc-700 dark:text-zinc-300">
                      {t("common.replyingTo")} {replyingTo.name}
                    </span>
                    <span className="block truncate text-zinc-500 dark:text-zinc-400">
                      {replyingTo.text || (replyingTo.kind === "gif" ? "GIF" : t("common.image"))}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setReply(null)}
                    aria-label={t("common.cancelReply")}
                    className="shrink-0 rounded-full p-1 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800"
                  >
                    <MdClose className="h-4 w-4" />
                  </button>
                </div>
              )}

              {attached.length > 0 && (
                // A tray above the box rather than an immediate send, exactly
                // as the room chat does it: a caption can then be written to
                // go with the pictures instead of arriving as a second message.
                <div className="flex shrink-0 gap-2 border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
                  {attached.map((dataUrl, index) => (
                    <span key={`${index}:${dataUrl.slice(-24)}`} className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={dataUrl} alt={t("common.attachment")} className="h-14 w-14 rounded-lg object-cover" />
                      <button
                        type="button"
                        onClick={() =>
                          activeId &&
                          setAttachments({
                            userId: activeId,
                            value: attached.filter((_, i) => i !== index),
                          })
                        }
                        aria-label={t("common.removeImage")}
                        className="absolute -right-1.5 -top-1.5 rounded-full bg-zinc-950 p-0.5 text-white shadow dark:bg-zinc-50 dark:text-zinc-950"
                      >
                        <MdClose className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {shownError && (
                <p className="shrink-0 px-4 pt-2 text-xs text-red-600 dark:text-red-400">{shownError}</p>
              )}

              <form
                onSubmit={handleSubmit}
                className="relative flex shrink-0 items-end gap-1 border-t border-zinc-200 px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] dark:border-zinc-800"
              >
                {emoji.open && (
                  <EmojiSuggestions
                    matches={emoji.matches}
                    highlight={emoji.highlight}
                    onHighlight={emoji.setHighlight}
                    onPick={emoji.pick}
                    className="absolute bottom-full left-2 right-2 mb-1"
                  />
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept={CHAT_IMAGE_ACCEPT}
                  multiple
                  hidden
                  onChange={(e) => {
                    void handleFiles(e.target.files);
                    // Reset so picking the same file twice in a row still
                    // fires a change event.
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={attached.length >= CHAT_IMAGE_MAX_PER_MESSAGE}
                  aria-label={t("common.sendImage")}
                  title={t("common.image")}
                  className={iconButton}
                >
                  <MdImage className="h-5 w-5" />
                </button>
                <Popover
                  open={gifOpen}
                  onClose={() => setGifOpen(false)}
                  placement="top-start"
                  tooltip="GIF"
                  content={
                    <div className="w-72 max-w-[calc(100vw-1rem)] rounded-xl border border-zinc-200 bg-white p-2 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
                      <GifPicker
                        onSelect={(gif) => {
                          setGifOpen(false);
                          if (!activeId) return;
                          // Sent on its own, as the room chat does: a GIF is
                          // the message, not an attachment to one.
                          send(activeId, { text: "", url: gif.url, replyTo: replyingTo });
                          setReply(null);
                        }}
                      />
                    </div>
                  }
                >
                  <button
                    type="button"
                    onClick={() => setGifOpen((current) => !current)}
                    aria-label={t("common.sendGif")}
                    className={iconButton}
                  >
                    <MdGif className="h-5 w-5" />
                  </button>
                </Popover>
                <textarea
                  ref={composerRef}
                  rows={1}
                  value={draft}
                  onChange={(e) => {
                    if (!activeId) return;
                    const { text } = emoji.handleChange(
                      e.target.value,
                      e.target.selectionStart ?? e.target.value.length
                    );
                    setDrafts((current) => ({ ...current, [activeId]: text }));
                  }}
                  onKeyDown={handleComposerKey}
                  onKeyUp={emoji.sync}
                  onClick={emoji.sync}
                  onFocus={emoji.prefetch}
                  // Only takes over the paste when the clipboard really carries
                  // an image: a copied <img> from a web page arrives as image
                  // data *and* HTML, and pasting plain text has to keep working
                  // untouched. Same rule the room chat uses.
                  onPaste={(e) => {
                    const files = Array.from(e.clipboardData?.files ?? []).filter((file) =>
                      file.type.startsWith("image/")
                    );
                    if (files.length === 0) return;
                    e.preventDefault();
                    const list = new DataTransfer();
                    for (const file of files) list.items.add(file);
                    void handleFiles(list.files);
                  }}
                  placeholder={attached.length > 0 ? t("directMessagesModal.captionOptional") : t("directMessagesModal.message")}
                  maxLength={MAX_LENGTH}
                  aria-label={t("common.message")}
                  className="max-h-36 min-h-[2.5rem] min-w-0 flex-1 resize-none rounded-2xl border border-zinc-300 bg-white px-3.5 py-2 text-sm leading-5 text-zinc-950 outline-none transition focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                />
                <EmojiPickerButton onPick={emoji.insert} className={iconButton} />
                <button
                  type="submit"
                  disabled={!canSend}
                  aria-label={t("common.send")}
                  title={t("directMessagesModal.sendEnter")}
                  className="shrink-0 rounded-full bg-zinc-950 p-2.5 text-white transition hover:bg-zinc-800 disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
                >
                  <MdSend className="h-5 w-5" />
                </button>
              </form>
            </>
          )}
        </div>
      </div>
      {/* Outside the backdrop, not inside it. React delivers a click inside a
          portal to the portal's parents in the component tree, so while this
          lived in the backdrop every click on the enlarged picture — including
          the one that closes it — also closed the whole conversation. */}
      <ChatImageModal preview={imageModalPreview} onClose={() => setImageModalPreview(null)} />
    </>,
    document.body
  );
}

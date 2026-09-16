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
import useNtPopups from "ntpopups";
import {
  MdArrowBack,
  MdCall,
  MdCallEnd,
  MdChatBubbleOutline,
  MdCheck,
  MdClose,
  MdCloseFullscreen,
  MdContentCopy,
  MdDeleteOutline,
  MdDoneAll,
  MdEdit,
  MdErrorOutline,
  MdGif,
  MdKeyboardArrowDown,
  MdOpenInFull,
  MdOutlineAddReaction,
  MdRefresh,
  MdReply,
  MdSchedule,
  MdSend,
  MdSettings,
} from "react-icons/md";
import { LuPanelLeftClose, LuPanelLeftOpen } from "react-icons/lu";
import { GifPicker } from "@/components/GifPicker";
import { InviteEmbeds } from "@/components/groups/InviteEmbed";
import { Popover, Tooltip } from "@/components/Tooltip";
import { AttachMenu, splitPicked } from "@/components/AttachMenu";
import { AttachmentTray } from "@/components/AttachmentTray";
import { MessageAttachments } from "@/components/MessageAttachments";
import { ChatImages } from "@/components/ChatImages";
import { attachmentsPreview, type ChatAttachment } from "@/lib/chatAttachments";
import { useAttachmentUploads } from "@/lib/useAttachmentUploads";
import { EmojiPickerButton } from "@/components/EmojiPicker";
import { EmojiSuggestions } from "@/components/EmojiSuggestions";
import { Twemoji } from "@/components/Twemoji";
import { QUICK_REACTIONS, ReactionPicker } from "@/components/groups/ReactionPicker";
import { copyText } from "@/lib/clipboard";
import { openContextMenu } from "@/lib/contextMenu";
import { useEmojiAutocomplete } from "@/lib/useEmojiAutocomplete";
import { ChatImageModal, type ChatImagePreviewState } from "@/components/ChatImageModal";
import {
  CHAT_IMAGE_MAX_PER_MESSAGE,
  isSupportedChatImage,
  prepareChatImage,
} from "@/lib/chatImage";
import { DisplayUserName } from "@/components/DisplayUserName";
import { UserAvatar } from "@/components/UserAvatar";
import { useAuth } from "@/lib/AuthContext";
import { verifiedBadge } from "@/lib/entitlements";
import { openDirectMessages, setDirectMessagesExpanded, useDirectMessagesOutlet } from "@/lib/dmWindow";
import { CallOutlet } from "@/components/CallOutlet";
import { ColumnResizeHandle, useColumnWidth, type ColumnWidthSpec } from "@/components/ColumnResize";
import { useCallSession } from "@/lib/callSession";
import { useCallActions } from "@/lib/callActions";
import { startCall } from "@/lib/callsApi";
import { toggleDmCallColumns, useDmCallColumnsCollapsed } from "@/lib/dmCallColumns";
import { useSignalingSelector, shallow } from "@/lib/useSignalingSelector";
import { selectCallNudge, selectRecentDms } from "@/lib/signalingSelectors";
import type { CallWire } from "@/lib/signalingClient";
import { presenceLabel, usePresence } from "@/lib/presence";
import {
  DM_MAX_REACTIONS_PER_MESSAGE,
  deleteDirectMessage,
  editDirectMessage,
  fetchConversation,
  fetchConversations,
  markConversationRead,
  reactToDirectMessage,
  sendDirectMessage,
  sendDmTyping,
  type Conversation,
  type DirectMessage,
  type DmCallInfo,
  type DmReaction,
  type DmReplyTo,
} from "@/lib/dmApi";
import type { SocialUser } from "@/lib/socialApi";
import {
  createSendQueue,
  liveConversationList,
  mayHaveMore,
  messageSummary,
  newestFrom,
  newestOutside,
  reactionsFor,
  seenThrough,
  threadMessages,
  unconfirmed,
  withChanges,
  withConfirmed,
  withFreshPage,
  withOlderPage,
} from "@/lib/dmThread";
import { loadDmSettings, noteDmChange, noteDmEdit, noteDmReactions, setDmReadReceipts, useDmLive } from "@/lib/dmLive";
import { describeReaction, toggleReaction as toggledReactions } from "@/lib/groupReactions";
import { createTypingAnnouncer, formatTypingLabel, type TypingAnnouncer } from "@/lib/typing";
import { MD_BREAKPOINT_QUERY, useMediaQuery } from "@/lib/useMediaQuery";
import { useT } from "@/lib/useI18n";
import { translate } from "@/lib/i18n";
import { formatLocale } from "@/lib/i18n";
import { usePageInFront } from "@/lib/pageFocus";
import { Markdown } from "@/components/Markdown";
import { stripMarkdown } from "@/lib/markdown";

// Private messages, in a dialog — or across the whole screen.
//
// A dialog and not a page, for the reason the friend requests learned first:
// navigating out of a room ends the call (WatchRoom's unmount calls
// leaveRoom), and answering a message mid-conversation should not cost the
// conversation. Everything here therefore has to work stacked over whatever
// is behind it, including a live call. The expanded mode keeps that rule: it
// is the same window drawn over the whole screen, not a route.
//
// Two screens in one: the list of conversations, and one thread. `openWith`
// jumps straight to a thread — that is what a notification click does.
// Expanded, from `md` up, the two sit side by side like a group's text room,
// and the thread is drawn as that room's rows rather than as bubbles.
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
//
// And what the conversation itself says beyond the messages — "digitando",
// "visto", the reactions — lives in lib/dmLive, fed by the socket, because it
// arrives whether or not this window is open to hear it.

/** Two messages from one person this close together read as one thought. */
const GROUP_GAP_MS = 5 * 60 * 1000;
/** How close to the bottom still counts as "reading the newest line". */
const NEAR_BOTTOM_PX = 96;
/** How close to the top starts reading the page before. */
const NEAR_TOP_PX = 80;
const COMPOSER_MAX_HEIGHT_PX = 144;
const MAX_LENGTH = 2000;
// How long a call line that still says "em chamada" is believed. It is closed
// by the call's room emptying out (see the API's callMessages' finishCallRoom),
// so the only way one stays open is a room that was never cleaned up — and a
// conversation is better off forgetting such a call than offering to join it
// forever.
const ONGOING_CALL_MAX_AGE_MS = 12 * 60 * 60 * 1000;
// The conversations column, dragged wider or narrower from its inner edge and
// remembered per browser — the group shell's two columns, with the same grip
// and the same double-click back to the default (see components/ColumnResize).
// Only in the expanded layout: the narrow window is one column at a time.
const LIST_COLUMN: ColumnWidthSpec = {
  storageKey: "dms:listColumnWidth",
  defaultWidth: 320,
  min: 240,
  max: 480,
  maxShare: 0.3,
  side: "left",
};
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

/** When a message was edited, for the "(editada)" hover: the day and the time. */
function editedLabel(ts: number): string {
  return new Date(ts).toLocaleString(formatLocale(), { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
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
  /** Receipts for files already uploaded, and the files as drawn until the server answers. */
  attachments?: string[];
  files?: ChatAttachment[];
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
  /** How far they had read when the page was read — null when not shared. */
  seenTs: number | null;
  /** When the page was asked for, so a live reaction older than it loses (see reactionsFor). */
  readAt: number;
};

/**
 * A value that belongs to one thread. Tagging is what lets a reply, a set of
 * attachments or an error stay with the conversation it was made in — switch
 * threads and it is simply not shown, switch back and it is still there —
 * without an effect having to clear anything.
 */
type Tagged<T> = { userId: string; value: T };

/** Who wrote a line, for the expanded rows that name their author. */
type Author = {
  id: string;
  name: string;
  avatarUrl: string | null;
  flags: string[];
  bot?: boolean;
  nameColor: string | null;
};

/** Everything a bubble needs, whether delivered or still on its way. */
type Bubble = {
  key: string;
  mine: boolean;
  text: string;
  kind?: DirectMessage["kind"];
  /** Set only on a call's line, which is drawn as a line and not as a bubble. */
  call?: DmCallInfo;
  url?: string;
  images?: string[];
  attachments?: ChatAttachment[];
  replyTo?: DmReplyTo | null;
  ts: number;
  status?: Pending["status"];
  error?: string;
  /** What "responder" quotes. Only a delivered message can be answered. */
  replyTarget?: DmReplyTo;
  clientId?: string;
  /** The delivered message's id — only a delivered message can be reacted to. */
  messageId?: string;
  /** When its text was last changed, if ever. */
  editedAt?: number;
  reactions: DmReaction[];
  /** Mine, delivered, and read by the other side (with "visto" shared). */
  seen: boolean;
  author: Author | null;
};

// ─── Pieces ─────────────────────────────────────────────────────────────

// One reaction under a message — the group rooms' pill (see TextChannelView),
// so a reaction looks like a reaction wherever it is.
const reactionChip = "inline-flex h-6 items-center gap-1 rounded-full border px-1.5 text-xs font-medium transition";
const reactionChipIdle =
  "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300";
const reactionChipMine =
  "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-500/15 dark:text-blue-300";

/** The small round buttons beside a bubble. */
const bubbleAction =
  "shrink-0 cursor-pointer self-center rounded-full p-1.5 text-zinc-400 opacity-100 transition hover:bg-zinc-100 hover:text-zinc-700 focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 dark:hover:bg-zinc-900 dark:hover:text-zinc-200";
/** The same, in the expanded rows — the text room's hover actions. */
const rowAction =
  "inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-zinc-400 opacity-100 transition hover:bg-zinc-200/70 hover:text-zinc-800 active:scale-95 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200";

function MessageBubble({
  bubble,
  grouped,
  layout,
  selfId,
  otherName,
  pickerFor,
  showSeenLabel,
  editing,
  onPicker,
  onReact,
  onReply,
  onEdit,
  onDelete,
  onOpenImage,
  onRetry,
  onDiscard,
  onMediaLoad,
  onMenu,
}: {
  bubble: Bubble;
  grouped: boolean;
  /** Bubbles in the dialog; the text room's rows when expanded. */
  layout: "bubbles" | "rows";
  selfId: string;
  otherName: string;
  /** Which reaction picker is open, as "<message id>:<where>". */
  pickerFor: string | null;
  /** The rows' "Visto" line, under the newest of mine that was read. */
  showSeenLabel: boolean;
  /** Open in the composer to be edited — marked while it is. */
  editing: boolean;
  onPicker: (key: string | null) => void;
  onReact: (bubble: Bubble, emoji: string) => void;
  onReply: (reply: DmReplyTo) => void;
  /** Absent for a message that cannot be edited (somebody else's, a GIF, one still sending). */
  onEdit?: (bubble: Bubble) => void;
  /** Absent for a message that cannot be deleted. `skipConfirm` is Shift held. */
  onDelete?: (bubble: Bubble, skipConfirm: boolean) => void;
  onOpenImage: (images: string[], index: number, alt: string) => void;
  onRetry: (clientId: string) => void;
  onDiscard: (clientId: string) => void;
  onMediaLoad: () => void;
  onMenu: (event: ReactMouseEvent, bubble: Bubble) => void;
}) {
  const t = useT();
  const { mine, status } = bubble;
  const failed = status === "failed";
  const images = bubble.images ?? [];
  const rows = layout === "rows";
  const canReact = Boolean(bubble.messageId);

  function nameOf(userId: string): string {
    return userId === selfId ? t("common.you") : otherName;
  }

  function reactionPicker(where: "actions" | "row", className: string, icon: ReactNode) {
    const key = `${bubble.messageId}:${where}`;
    const isOpen = pickerFor === key;
    return (
      <Popover
        open={isOpen}
        onClose={() => onPicker(null)}
        placement={mine && !rows ? "bottom-end" : "bottom-start"}
        tooltip={t("directMessagesModal.react")}
        content={<ReactionPicker onSelect={(emoji) => onReact(bubble, emoji)} />}
      >
        <button
          type="button"
          onClick={() => onPicker(isOpen ? null : key)}
          aria-label={t("directMessagesModal.react")}
          // Kept visible while its picker is open, or the hover that drew it
          // going away would take the button the picker is anchored to along.
          className={`${className} ${isOpen ? "sm:opacity-100" : ""}`}
        >
          {icon}
        </button>
      </Popover>
    );
  }

  const actions = (className: string) =>
    bubble.replyTarget ? (
      <span className={`flex shrink-0 items-center ${rows ? "" : "self-center"}`}>
        {canReact && reactionPicker("actions", className, <MdOutlineAddReaction className={rows ? "h-3.5 w-3.5" : "h-4 w-4"} />)}
        <button
          type="button"
          aria-label={t("common.reply")}
          title={t("common.reply")}
          onClick={() => onReply(bubble.replyTarget!)}
          className={className}
        >
          <MdReply className={rows ? "h-3.5 w-3.5" : "h-4 w-4"} />
        </button>
        {onEdit && (
          <button
            type="button"
            aria-label={t("common.edit")}
            title={t("common.edit")}
            onClick={() => onEdit(bubble)}
            className={className}
          >
            <MdEdit className={rows ? "h-3.5 w-3.5" : "h-4 w-4"} />
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            aria-label={t("common.delete")}
            title={t("groups.textChannelView.deleteShiftHint")}
            onClick={(e) => onDelete(bubble, e.shiftKey)}
            className={className}
          >
            <MdDeleteOutline className={rows ? "h-3.5 w-3.5" : "h-4 w-4"} />
          </button>
        )}
      </span>
    ) : null;

  // Discord's "(editada)", at the end of the words, with when on hover.
  const editedMark = bubble.editedAt ? (
    <span
      title={t("groups.textChannelView.editedAt", { when: editedLabel(bubble.editedAt) })}
      className={`ml-1 select-none ${
        rows
          ? "text-[11px] text-zinc-400 dark:text-zinc-500"
          : mine
            ? "text-[10px] text-white/60 dark:text-zinc-950/60"
            : "text-[10px] text-zinc-400"
      }`}
    >
      ({t("groups.textChannelView.edited")})
    </span>
  ) : null;

  const quote = bubble.replyTo && (
    // A snapshot taken when the reply was sent, not a pointer (see the API
    // side). It keeps saying what it said even when the original is far
    // outside the loaded page.
    <span
      className={`mb-1 block border-l-2 pl-2 text-xs opacity-75 ${
        mine && !rows ? "border-white/40 dark:border-zinc-950/30" : "border-zinc-400"
      }`}
    >
      <span className="block font-medium">@{bubble.replyTo.name}</span>
      <span className="line-clamp-2 break-words">
        {stripMarkdown(bubble.replyTo.text ?? "") || (bubble.replyTo.kind === "gif" ? "GIF" : t("common.image"))}
      </span>
    </span>
  );

  const media = (
    <>
      {bubble.kind === "gif" && bubble.url && (
        <button
          type="button"
          onClick={() => onOpenImage([bubble.url!], 0, "GIF")}
          aria-label={t("common.enlargeTheGif")}
          className={`${rows ? "mt-1" : "-mx-1 mb-1"} block cursor-zoom-in rounded-lg text-left transition hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={bubble.url}
            alt="GIF"
            onLoad={onMediaLoad}
            className={`${rows ? "max-h-48" : "max-h-56"} block max-w-full rounded-lg object-contain`}
          />
        </button>
      )}
      <ChatImages
        images={images}
        onOpen={(index) => onOpenImage(images, index, t("common.image"))}
        onLoad={onMediaLoad}
        alt={t("common.image")}
        label={t("common.enlargeTheImage")}
        className={rows ? "mt-1 max-w-sm" : "-mx-1 mb-1"}
      />
      <MessageAttachments attachments={bubble.attachments} className={rows ? "" : "-mx-1 mb-1"} />
    </>
  );

  const reactions = bubble.reactions.length > 0 && (
    // Each emoji once, lit when one of them is yours; clicking joins it or
    // takes yours back. With two people, a count only says something above one.
    <div className={`mt-1 flex flex-wrap items-center gap-1 ${mine && !rows ? "justify-end" : ""}`}>
      {bubble.reactions.map((reaction) => {
        const on = reaction.users.includes(selfId);
        return (
          <button
            key={reaction.emoji}
            type="button"
            aria-pressed={on}
            onClick={() => onReact(bubble, reaction.emoji)}
            title={describeReaction(reaction, nameOf)}
            className={`${reactionChip} cursor-pointer ${
              on
                ? `${reactionChipMine} hover:bg-blue-100 dark:hover:bg-blue-500/25`
                : `${reactionChipIdle} hover:border-zinc-400 dark:hover:border-zinc-600`
            }`}
          >
            <Twemoji emoji={reaction.emoji} size={16} />
            {reaction.users.length > 1 && <span className="tabular-nums">{reaction.users.length}</span>}
          </button>
        );
      })}
      {rows &&
        canReact &&
        bubble.reactions.length < DM_MAX_REACTIONS_PER_MESSAGE &&
        reactionPicker(
          "row",
          `${reactionChip} ${reactionChipIdle} cursor-pointer hover:border-zinc-400 dark:hover:border-zinc-600`,
          <MdOutlineAddReaction className="h-3.5 w-3.5 opacity-70" />
        )}
    </div>
  );

  const failure = failed && bubble.clientId && (
    // Said under the message, in words, with the two things that can be done
    // about it. What was written is never thrown away on its own.
    <span
      className={`mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-red-600 dark:text-red-400 ${
        rows ? "" : "justify-end"
      }`}
    >
      <span className="flex items-center gap-1">
        <MdErrorOutline className="h-3.5 w-3.5 shrink-0" />
        {bubble.error ?? t("common.notSent")}
      </span>
      <button type="button" onClick={() => onRetry(bubble.clientId!)} className="font-semibold underline underline-offset-2">
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
  );

  if (rows) {
    // The group text room's line: a face and a name over a run from one
    // person, the time beside the name, actions on hover at the right.
    const author = bubble.author;
    return (
      <li
        onContextMenu={(e) => onMenu(e, bubble)}
        className={`group relative -mx-1.5 rounded-lg px-2 text-sm transition-colors ${
          editing
            ? "bg-amber-50 ring-1 ring-amber-300 dark:bg-amber-500/10 dark:ring-amber-500/40"
            : "hover:bg-zinc-100/80 dark:hover:bg-zinc-900/70"
        } ${grouped ? "pb-0.5" : "mt-2.5 pb-0.5"} ${status === "sending" ? "opacity-60" : ""}`}
      >
        {bubble.replyTo && <div className="pt-1 text-zinc-700 dark:text-zinc-300">{quote}</div>}
        {!grouped && author && (
          <div className="flex items-center justify-between gap-1.5">
            <span className="flex min-w-0 items-center gap-1.5">
              <UserAvatar src={author.avatarUrl} name={author.name} size={20} userId={author.id} />
              <span className="flex min-w-0 items-baseline gap-1.5">
                <DisplayUserName
                  name={author.name}
                  verified={verifiedBadge(author.flags)}
                  bot={author.bot}
                  color={author.nameColor}
                  className="min-w-0 truncate font-medium text-zinc-700 dark:text-zinc-300"
                />
                <span className="flex shrink-0 items-center gap-1 text-xs tabular-nums text-zinc-400 dark:text-zinc-600">
                  {status === "sending" && <MdSchedule className="h-3 w-3" aria-label={t("directMessagesModal.sending")} />}
                  {timeLabel(bubble.ts)}
                </span>
              </span>
            </span>
            {actions(rowAction)}
          </div>
        )}
        <div className={grouped ? "flex items-start justify-between gap-1.5" : ""}>
          <div className="min-w-0 flex-1">
            {bubble.text && (
              <div className="select-text break-words text-zinc-900 dark:text-zinc-100">
                <Markdown text={bubble.text} renderText={(plain) => linkify(plain, false)} trailing={editedMark} />
              </div>
            )}
            {bubble.text && <InviteEmbeds text={bubble.text} />}
            {media}
            {reactions}
            {failure}
            {showSeenLabel && (
              <p className="mt-0.5 flex items-center gap-1 text-[11px] text-zinc-400 dark:text-zinc-500">
                <MdDoneAll className="h-3.5 w-3.5 text-sky-500" />
                {t("directMessagesModal.seen")}
              </p>
            )}
          </div>
          {grouped && actions(rowAction)}
        </div>
      </li>
    );
  }

  return (
    <li
      onContextMenu={(e) => onMenu(e, bubble)}
      className={`group flex items-end gap-0.5 ${mine ? "justify-end" : "justify-start"} ${
        grouped ? "mt-0.5" : "mt-2.5"
      }`}
    >
      {mine && actions(bubbleAction)}
      <div className={`flex max-w-[82%] flex-col ${mine ? "items-end" : "items-start"}`}>
        <div
          className={`rounded-2xl px-3 py-1.5 text-sm transition ${
            mine
              ? `bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950 ${grouped ? "rounded-tr-md" : ""}`
              : `bg-zinc-100 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100 ${grouped ? "rounded-tl-md" : ""}`
          } ${status === "sending" ? "opacity-70" : ""} ${failed ? "ring-2 ring-red-500/70" : ""} ${
            editing ? "ring-2 ring-amber-400 dark:ring-amber-500" : ""
          }`}
        >
          {quote}
          {media}
          {bubble.text && (
            <div className="select-text break-words">
              <Markdown text={bubble.text} compact renderText={(plain) => linkify(plain, mine)} trailing={editedMark} />
            </div>
          )}
          <span
            className={`mt-0.5 flex items-center justify-end gap-1 text-[10px] leading-none ${
              mine ? "text-white/60 dark:text-zinc-950/60" : "text-zinc-400"
            }`}
          >
            {status === "sending" && <MdSchedule className="h-3 w-3" aria-label={t("directMessagesModal.sending")} />}
            {timeLabel(bubble.ts)}
            {bubble.seen && (
              <MdDoneAll
                className="h-3.5 w-3.5 text-sky-400 dark:text-sky-600"
                aria-label={t("directMessagesModal.seen")}
              />
            )}
          </span>
        </div>
        {/* Under the bubble rather than in it: the card keeps its own colours
            whichever side's bubble the link was sent in. */}
        {bubble.text && <InviteEmbeds text={bubble.text} />}
        {reactions}
        {failure}
      </div>
      {!mine && actions(bubbleAction)}
    </li>
  );
}

/** "Digitando", as the other side's bubble: three dots taking turns. */
function TypingBubble({ label }: { label: string }) {
  const dots = (
    <span className="flex items-center gap-1" aria-hidden>
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 dark:bg-zinc-500"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
  return (
    <li className="mt-2.5 flex justify-start" aria-live="polite" aria-label={label}>
      <span className="rounded-2xl rounded-tl-md bg-zinc-100 px-3 py-2.5 dark:bg-zinc-900">{dots}</span>
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

/**
 * A call's own line in the conversation — not a bubble but a note across the
 * middle, the way every messenger records one.
 *
 * What it says depends on which end of the call the reader was on: the same
 * record is "ninguém atendeu" to whoever rang and "chamada perdida" to
 * whoever was rung. That is why the API stores what happened and never a
 * sentence (see its callMessages.ts).
 */
function CallLine({
  call,
  mine,
  otherName,
  ts,
}: {
  call: DmCallInfo;
  /** Whether this account is the one that placed the call. */
  mine: boolean;
  otherName: string;
  ts: number;
}) {
  const t = useT();
  // Missed, refused, given up on: the three that are worth spotting while
  // scrolling past. An answered call is just something that happened.
  const failed = call.state === "missed" || call.state === "declined" || call.state === "cancelled";
  const label = (() => {
    switch (call.state) {
      case "ringing":
        return mine ? t("directMessagesModal.callRinging") : t("directMessagesModal.callRingingYou", { displayName: otherName });
      case "ongoing":
        return mine
          ? t("directMessagesModal.callStartedByYou")
          : t("directMessagesModal.callStartedBy", { displayName: otherName });
      case "ended":
        return t("directMessagesModal.callEndedIn", { duration: callDuration(call.durationMs ?? 0) });
      case "missed":
        return mine ? t("directMessagesModal.callNobodyAnswered") : t("directMessagesModal.callMissed");
      case "declined":
        return mine ? t("directMessagesModal.callDeclined") : t("directMessagesModal.callYouDeclined");
      case "cancelled":
        return mine ? t("directMessagesModal.callYouCancelled") : t("directMessagesModal.callMissed");
    }
  })();
  return (
    <li className="my-2 flex justify-center">
      <span
        className={`inline-flex max-w-full items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${
          failed
            ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400"
            : "bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300"
        }`}
      >
        {failed ? <MdCallEnd className="h-4 w-4 shrink-0" /> : <MdCall className="h-4 w-4 shrink-0" />}
        <span className="truncate">{label}</span>
        <span className="shrink-0 text-[11px] font-normal opacity-70">{timeLabel(ts)}</span>
      </span>
    </li>
  );
}

/** How long a call lasted, as a clock: "4:07", or "1:02:30" past an hour. */
function callDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/**
 * A call this conversation has, that you are not in.
 *
 * Discord's rule, and the one people expect: a call is not a modal you either
 * catch or lose, it is a thing the conversation *has* — so opening somebody's
 * thread while they are ringing you shows the ring there, with the same two
 * buttons, and a call still going on after you left it shows a way back in.
 *
 * Which of the two is decided by the caller, not here: `incoming` is a ring the
 * socket still holds (see lib/signalingClient), `ongoing` is the conversation's
 * own record of a call that was answered and whose room has not emptied yet
 * (see the API's callMessages). They cannot both be true — a call stops ringing
 * the moment it is answered.
 */
function DmCallInvite({
  name,
  avatarUrl,
  ringing,
  busy,
  onAnswer,
  onDecline,
  onJoin,
}: {
  name: string;
  avatarUrl: string | null;
  /** A ring waiting to be answered, rather than a call already under way. */
  ringing: boolean;
  busy: boolean;
  onAnswer: () => void;
  onDecline: () => void;
  onJoin: () => void;
}) {
  const t = useT();
  return (
    <div className="shrink-0 border-b border-zinc-200 px-3 py-3 dark:border-zinc-800">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2.5 dark:border-emerald-900 dark:bg-emerald-950/30">
        <UserAvatar
          src={avatarUrl}
          name={name}
          size={40}
          // Only a ring pulses. A call already going on is a state, not a
          // question being asked of you.
          className={`shrink-0 ${ringing ? "animate-pulse" : ""}`}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-zinc-950 dark:text-zinc-50">{name}</p>
          <p className="truncate text-xs text-emerald-700 dark:text-emerald-400">
            {ringing ? t("directMessagesModal.isCallingYou") : t("directMessagesModal.callInProgress")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* Refusing is only ever on offer for a ring. There is nothing to
              refuse about a call that is simply happening without you. */}
          {ringing && (
            <button
              type="button"
              onClick={onDecline}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
            >
              <MdCallEnd className="h-4 w-4" />
              {t("common.decline")}
            </button>
          )}
          <button
            type="button"
            onClick={ringing ? onAnswer : onJoin}
            disabled={busy}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <MdCall className="h-4 w-4" />
            {ringing ? t("callHost.answer") : t("directMessagesModal.joinTheCall")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── The dialog ─────────────────────────────────────────────────────────

export function DirectMessagesModal({
  open,
  onClose,
  openWith,
  expanded = false,
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
  /** Whether it was asked to fill the screen — see lib/dmWindow's `expanded`. */
  expanded?: boolean;
}) {
  const t = useT();
  const { openPopup } = useNtPopups();
  const { account } = useAuth();
  const recentDms = useSignalingSelector(selectRecentDms);
  const now = useSyncExternalStore(subscribeClock, getClock, getClockServer);
  const pageInFront = usePageInFront();
  const live = useDmLive();
  // Side by side only where there is room for both. Below `md` the dialog is
  // already the whole screen, so "expanded" there changes nothing.
  const wide = useMediaQuery(MD_BREAKPOINT_QUERY);
  const split = expanded && wide;
  const layout = split ? "rows" : "bubbles";
  // Expanded on a page that lends it a place (the group pages, beside the list
  // of groups): drawn there, as part of the page, instead of over all of it.
  const outlet = useDirectMessagesOutlet();
  const docked = split && outlet !== null;
  // A direct call belongs to a conversation: it is drawn on that person's
  // thread rather than on a room page of its own (see lib/callSession's `dm`).
  const call = useCallSession();
  // Answering a ring, refusing it, walking into a call already going on — the
  // same steps the ringing screen uses (see lib/callActions).
  const { answer, stopRinging, joinOngoing } = useCallActions();
  // Every ring this account has, in either direction. Not filtered by
  // `alertTarget` the way the ringing screen is: that decides which connection
  // makes the *noise*, and a conversation showing whose call is waiting in it
  // is not noise. It is also the only way to answer from a tab the server did
  // not pick.
  const { incomingCalls, outgoingCall } = useSignalingSelector(selectCallNudge, shallow);
  // The lists beside the call, folded away — this window's own conversations
  // column and the rail of groups outside it, together (see lib/dmCallColumns).
  const columnsCollapsed = useDmCallColumnsCollapsed();
  const [answering, setAnswering] = useState(false);
  const { setElement: setListColumn, style: listColumnStyle, handle: listColumnHandle } =
    useColumnWidth(LIST_COLUMN);

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
  // One of this account's own messages, open in the box to be changed. The
  // conversation's draft waits in `drafts`, untouched, and is back in the box
  // the moment the edit is saved or dropped.
  const [editing, setEditing] = useState<Tagged<{ messageId: string; text: string }> | null>(null);
  const [attachments, setAttachments] = useState<Tagged<string[]> | null>(null);
  const [error, setError] = useState<Tagged<string> | null>(null);
  const [gifOpen, setGifOpen] = useState(false);
  const [imageModalPreview, setImageModalPreview] = useState<ChatImagePreviewState | null>(null);
  // The reaction picker that is open, as "<message id>:<where>".
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsFailed, setSettingsFailed] = useState(false);
  // Where the reader is in the thread, tagged like everything else so a thread
  // that has just opened starts out "at the bottom" without an effect.
  const [scroll, setScroll] = useState<{ userId: string; atBottom: boolean; seen: string | null } | null>(
    null
  );
  // Every send joins this, so they reach the server in the order written —
  // see createSendQueue. Made once, for the life of the dialog.
  const [enqueueSend] = useState(createSendQueue);

  // Videos and documents, uploading from the moment they are picked. One
  // tray for the dialog, tagged with the conversation it was filled for
  // (`filesFor`) — shown and sent only there, like the pictures.
  const uploads = useAttachmentUploads("dms");
  const [filesFor, setFilesFor] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  // Whether the press that became this click began on the backdrop itself.
  const pressedBackdropRef = useRef(false);
  const olderInFlightRef = useRef(false);
  const lastMarkedRef = useRef<string | null>(null);
  const focusedForRef = useRef<string | null>(null);
  // "Digitando" for the person whose thread is open — one announcer per
  // conversation, so switching threads says "stopped" to the one left behind.
  const typingRef = useRef<{ userId: string; announcer: TypingAnnouncer } | null>(null);
  const scrollMemoRef = useRef<{
    /** The box the memory is about — a new one (expanding remounts it) starts over. */
    node: HTMLDivElement | null;
    threadId: string | null;
    firstKey: string | null;
    lastKey: string | null;
    typing: boolean;
    height: number;
  }>({ node: null, threadId: null, firstKey: null, lastKey: null, typing: false, height: 0 });

  const activeId = openWith ?? null;
  const callHere = Boolean(activeId && call?.dm && call.dm.userId === activeId);
  const loaded = thread?.userId === activeId ? thread : null;
  // The name comes from the list when the thread has not arrived yet, so the
  // header is right on the first frame instead of saying "Carregando…".
  const active: SocialUser | null =
    loaded?.user ?? conversations?.find((c) => c.user.id === activeId)?.user ?? null;
  const presence = usePresence(activeId);
  const otherTyping = activeId ? Boolean(live.typing[activeId]) : false;
  // This account's own switch, once known. Unknown reads as "on" for drawing
  // the switch — it is the default — but never shows a "visto" on its own:
  // those only come from the server, which checks both sides.
  const myReadReceipts =
    account && live.readReceipts?.accountId === account.id ? live.readReceipts.value : null;
  const seenTs =
    loaded && activeId ? seenThrough(loaded.seenTs, live.seen[activeId], myReadReceipts) : null;

  const draft = activeId ? drafts[activeId] ?? "" : "";
  const replyingTo = reply && reply.userId === activeId ? reply.value : null;
  const editingHere = editing && editing.userId === activeId ? editing.value : null;
  const editingOpen = editingHere !== null;
  // What the box shows: the message being edited, or this conversation's draft.
  const boxText = editingHere ? editingHere.text : draft;
  const attached = attachments && attachments.userId === activeId ? attachments.value : [];
  const filesHere = filesFor !== null && filesFor === activeId ? uploads.items : [];
  const shownError = error && error.userId === (activeId ?? "") ? error.value : null;

  // ":" for emoji, ":sob:" → 😭, and the picker beside "send" — see
  // useEmojiAutocomplete. It writes into this conversation's draft.
  const emoji = useEmojiAutocomplete({
    textareaRef: composerRef,
    onReplace: (value) => {
      if (!activeId) return;
      setBoxText(activeId, value.slice(0, MAX_LENGTH));
    },
  });

  /** Writes what the box holds — into the edit when one is open, the draft otherwise. */
  function setBoxText(userId: string, text: string) {
    if (editing && editing.userId === userId) {
      setEditing({ userId, value: { ...editing.value, text } });
      return;
    }
    setDrafts((current) => ({ ...current, [userId]: text }));
  }

  // The fetched page, plus anything that arrived since — derived rather than
  // merged into state, so a message landing while this is open needs no effect
  // and cannot be lost between two renders. See lib/dmThread for the rules.
  // Edits and deletions heard since are laid over it the same way (see
  // lib/dmLive): a message deleted on the other side leaves at once.
  const messages = useMemo(
    () =>
      loaded && account && activeId
        ? withChanges(threadMessages(loaded.messages, recentDms, account.id, activeId), live.changes)
        : [],
    [loaded, recentDms, activeId, account, live.changes]
  );
  const outgoing = useMemo(
    () => unconfirmed(pending, messages, activeId),
    [pending, messages, activeId]
  );
  const newestIncomingId = newestFrom(messages, activeId);

  // ── The call this conversation has ──
  //
  // Three states, and the thread shows at most one of them: you are in it
  // (`callHere`, drawn as the call itself), somebody is ringing you from it, or
  // it is going on without you and can be walked back into.

  /** A ring from — or to — the person whose thread is open. */
  const ringingHere: CallWire | null =
    (activeId && incomingCalls.find((entry) => entry.from.id === activeId)) || null;
  const callingHere = Boolean(
    activeId && outgoingCall && outgoingCall.to.id === activeId
  );
  /**
   * A call that was answered and is not over — which is exactly what the
   * conversation's own call line says while its room still has somebody in it
   * (see the API's callMessages: the line goes to "ended" when the room empties
   * out). So one person leaving and the other staying leaves a way back in,
   * without a second source of truth to keep in step.
   *
   * Bounded by age all the same. The line is only ever closed by the room
   * emptying, and a room that was never cleaned up would otherwise leave an
   * "entrar na chamada" button in a conversation for good.
   */
  const ongoingHere = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (!message.call) continue;
      const info = live.calls[message.id] ?? message.call;
      // The newest call line is the only one worth looking at: an older one
      // that still says "ongoing" is a line the server never got to close.
      if (info.state !== "ongoing") return null;
      const startedAt = info.startedAt ?? message.ts;
      // The screen's own clock, not Date.now(): reading the time during render
      // is what makes a render impure (see subscribeClock above).
      if (now - startedAt > ONGOING_CALL_MAX_AGE_MS) return null;
      return info;
    }
    return null;
  }, [messages, live.calls, now]);
  // Never both: a call stops ringing the moment it is answered, and the call
  // you are already in is drawn as the call and not as an invitation.
  const callInvite = callHere || callingHere ? null : ringingHere ? "ringing" : ongoingHere ? "ongoing" : null;

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
        ? liveConversationList(conversations, recentDms, account.id, live.changes)
        : conversations,
    [conversations, recentDms, account, live.changes]
  );
  const listVisible = !activeId || split;
  // Folded away only while the call it made room for is on this very thread:
  // moving to another conversation brings the list back, because the reason it
  // was gone is no longer on screen.
  const listFolded = columnsCollapsed && callHere;
  // What the list re-reads on: a delivery outside the open thread (see
  // newestOutside). With no thread open, that is every delivery.
  const listNudge = account ? newestOutside(recentDms, account.id, activeId) : null;

  // ── Effects ─────────────────────────────────────────────────────────

  // Escape undoes one thing at a time: the pickers or the picture (which close
  // themselves on the same key), then the reply being written, then the
  // thread, and only then the dialog.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (gifOpen || imageModalPreview || pickerFor || settingsOpen) return;
      // Said out loud, so Android's back button — which arrives here as this
      // same key (see lib/nativeApp's closeTopLayer) — knows it closed
      // something and does not also leave the page.
      event.preventDefault();
      if (editingOpen) {
        setEditing(null);
        return;
      }
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
  }, [open, activeId, onClose, gifOpen, imageModalPreview, replyingTo, editingOpen, pickerFor, settingsOpen]);

  // The page behind stays put. Scrolling a conversation to its end and
  // carrying on into the room's chat underneath is the kind of thing that
  // makes a dialog feel like it is not really there.
  // Docked, it *is* part of the page, which has nothing behind it to scroll.
  useEffect(() => {
    if (!open || docked) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open, docked]);

  // This account's "visto" switch, read once per account.
  useEffect(() => {
    if (open && account) loadDmSettings(account.id);
  }, [open, account]);

  // Leaving a thread — for another one, or closing — tells the person left
  // behind that the writing stopped, rather than letting it expire on them.
  useEffect(() => {
    if (!open) return;
    return () => {
      typingRef.current?.announcer.dispose();
      typingRef.current = null;
    };
  }, [open, activeId]);

  // The list — only while it is on screen. It used to be re-read on *every*
  // message, including while a thread was open and nobody could see it; that
  // was a pair of aggregations on the server per message received. Now it
  // re-reads on what the open thread cannot account for (see listNudge), and
  // on switching threads, which is when an unread count just went to zero —
  // and on a deletion, which may have taken a row's newest line with it.
  // Debounced, so a burst is one read.
  const deletions = live.deletions;
  useEffect(() => {
    if (!open || !account || !listVisible) return;
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
  }, [open, account, activeId, listVisible, listNudge, listSeq, deletions]);

  // Whichever thread the store is pointing at. What was already on screen for
  // it stays there while the fresh page loads, and anything newer than that
  // page — a message sent while it was in flight — is carried over rather than
  // dropped by the replace.
  useEffect(() => {
    if (!open || !activeId) return;
    const controller = new AbortController();
    const readAt = Date.now();
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
        seenTs: data.seenTs,
        readAt,
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
  }, [boxText, activeId, open, split]);

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
    if (memo.threadId !== activeId || memo.node !== node) {
      // A thread that just opened starts at its newest line — and so does one
      // whose box was just rebuilt, by going full screen or back.
      node.scrollTop = node.scrollHeight;
    } else if (firstKey !== memo.firstKey && lastKey === memo.lastKey) {
      // An older page went in above. Keep the line the reader was on exactly
      // where it was, rather than letting the new history shove it down.
      node.scrollTop += node.scrollHeight - memo.height;
    } else if (lastKey !== memo.lastKey && (atBottom || lastIsMine)) {
      // Something new at the end. Followed only if the reader was already
      // there, or if it is theirs — otherwise the pill says it arrived.
      node.scrollTop = node.scrollHeight;
    } else if (otherTyping !== memo.typing && atBottom) {
      // The "digitando" bubble came or went at the end: whoever was reading
      // the newest line keeps reading it.
      node.scrollTop = node.scrollHeight;
    }
    scrollMemoRef.current = {
      node,
      threadId: activeId,
      firstKey,
      lastKey,
      typing: otherTyping,
      height: node.scrollHeight,
    };
  }, [activeId, loaded, firstKey, lastKey, lastIsMine, atBottom, otherTyping, split]);

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
    // The message arriving is what clears "digitando" on the other side.
    if (typingRef.current?.userId === to) typingRef.current.announcer.sent();
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

  /**
   * Rings `userId`, and says why on this composer if it could not — blocked,
   * rate-limited, "recebendo outras chamadas agora". `startCall` used to be
   * fired here without ever looking at what it returned, unlike every other
   * caller of it in the app (HomeFriendsPanel, FriendsPanel, SocialActions),
   * so a call that failed to even start looked identical to one that rang and
   * was never answered.
   */
  async function placeCall(userId: string) {
    const result = await startCall(userId);
    if (!result.ok) setError({ userId, value: result.error });
  }

  /** "Atender", from the conversation rather than from the ringing screen. */
  async function answerHere() {
    if (!ringingHere || answering) return;
    setAnswering(true);
    const result = await answer(ringingHere);
    setAnswering(false);
    // The ring is off the screen either way (see lib/callActions); the error
    // goes where this conversation's errors go.
    if (!result.ok && activeId) setError({ userId: activeId, value: result.error });
  }

  function declineHere() {
    if (ringingHere) void stopRinging(ringingHere.id, "decline");
  }

  /** Back into a call still going on — one left, or answered on another device. */
  function joinHere() {
    if (!ongoingHere || !activeId || !active) return;
    joinOngoing(ongoingHere.roomHandle, {
      userId: activeId,
      displayName: active.displayName,
      avatarUrl: active.avatarUrl ?? null,
    });
  }

  function submit() {
    if (!activeId) return;
    if (editingHere) {
      void saveEdit(activeId, editingHere.messageId, editingHere.text);
      composerRef.current?.focus({ preventScroll: true });
      return;
    }
    const text = emoji.convert(draft).trim();
    if (!text && attached.length === 0 && filesHere.length === 0) return;
    // The files have to be on the CDN before the message can name them.
    if (filesHere.length > 0 && uploads.uploading) {
      setError({ userId: activeId, value: t("attachments.stillUploading") });
      return;
    }
    if (filesHere.length > 0 && uploads.failed) {
      setError({ userId: activeId, value: t("attachments.removeFailedFiles") });
      return;
    }
    send(activeId, {
      text,
      ...(attached.length > 0 ? { images: attached } : {}),
      ...(filesHere.length > 0 ? { attachments: uploads.tokens, files: uploads.attachments } : {}),
      replyTo: replyingTo,
    });
    setDrafts((current) => ({ ...current, [activeId]: "" }));
    setAttachments(null);
    if (filesHere.length > 0) {
      uploads.clear();
      setFilesFor(null);
    }
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
    // ↑ in an empty box: Discord's way into editing your last message.
    if (
      event.key === "ArrowUp" &&
      !editingHere &&
      !draft &&
      attached.length === 0 &&
      filesHere.length === 0 &&
      !event.shiftKey &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      const mine = account?.id;
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        const message = messages[i];
        if (message.from !== mine || message.kind === "gif") continue;
        event.preventDefault();
        startEdit(message.id, message.text);
        return;
      }
    }
    // Enter sends, Shift+Enter is a new line — except while an input method is
    // still composing a character, where Enter is how the character is chosen.
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    if (isCoarsePointer()) return;
    event.preventDefault();
    submit();
  }

  /** Tells `to` about what is in the box now — when to, is lib/typing's call. */
  function announceTyping(to: string, value: string) {
    if (typingRef.current?.userId !== to) {
      typingRef.current?.announcer.dispose();
      typingRef.current = {
        userId: to,
        announcer: createTypingAnnouncer((typing) => sendDmTyping(to, typing)),
      };
    }
    typingRef.current.announcer.input(value);
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

  // Whatever came through "Vídeo" or "Arquivo": pictures still go to the
  // picture tray, everything else is uploaded as it is — into a tray that
  // belongs to this conversation, so files left in another one are dropped.
  function handleAnyFiles(files: File[]) {
    const to = activeId;
    if (!to) return;
    const { images, others } = splitPicked(files, isSupportedChatImage);
    if (images.length > 0) {
      const list = new DataTransfer();
      for (const file of images) list.items.add(file);
      void handleFiles(list.files);
    }
    if (others.length > 0) {
      if (filesFor !== to) uploads.clear();
      setFilesFor(to);
      void uploads.add(others);
    }
  }

  // ── Editing and deleting ────────────────────────────────────────────
  //
  // This account's own delivered messages only, as in the group rooms — and
  // a GIF has no text to change. Both are drawn at once (see lib/dmLive's
  // noteDmChange) and put back, with the reason, if the server refuses.

  function canEdit(bubble: Bubble): boolean {
    return bubble.mine && Boolean(bubble.messageId) && bubble.kind !== "gif";
  }

  function canDelete(bubble: Bubble): boolean {
    return bubble.mine && Boolean(bubble.messageId);
  }

  function startEdit(messageId: string, text: string) {
    if (!activeId) return;
    setReply(null);
    setEditing({ userId: activeId, value: { messageId, text } });
    // What an edit is typed over is not a new message: a "digitando" already
    // announced to them ends here.
    if (typingRef.current?.userId === activeId) typingRef.current.announcer.input("");
    requestAnimationFrame(() => {
      const node = composerRef.current;
      if (!node) return;
      node.focus({ preventScroll: true });
      node.setSelectionRange(node.value.length, node.value.length);
    });
  }

  // Erased to nothing, a message is one to delete — and asks so. Pictures
  // or files keep a message that loses its caption.
  async function saveEdit(userId: string, messageId: string, raw: string) {
    setEditing(null);
    const original = messages.find((m) => m.id === messageId);
    if (!original) return;
    const text = emoji.convert(raw).trim();
    if (!text && !original.images?.length && !original.attachments?.length) {
      confirmDelete(userId, messageId);
      return;
    }
    if (text === original.text) return;
    const before = live.changes[messageId] ?? null;
    noteDmEdit(messageId, text);
    const result = await editDirectMessage(userId, messageId, text);
    if (result.ok) {
      noteDmEdit(messageId, result.message.text, result.message.editedAt);
      return;
    }
    noteDmChange(messageId, before);
    setError({ userId, value: result.error });
  }

  async function deleteNow(userId: string, messageId: string) {
    const before = live.changes[messageId] ?? null;
    if (editing?.value.messageId === messageId) setEditing(null);
    noteDmChange(messageId, { deleted: true });
    const result = await deleteDirectMessage(userId, messageId);
    if (result.ok) return;
    noteDmChange(messageId, before);
    setError({ userId, value: result.error });
  }

  // Shift held: gone at once, as in the group rooms. Otherwise it asks first.
  function confirmDelete(userId: string, messageId: string, skipConfirm = false) {
    if (skipConfirm) {
      void deleteNow(userId, messageId);
      return;
    }
    void openPopup("confirm", {
      data: {
        title: t("groups.textChannelView.deleteMessage"),
        message: t("directMessagesModal.deleteForBoth"),
        cancelLabel: t("common.cancel"),
        confirmLabel: t("common.delete"),
        confirmStyle: "Danger",
        onChoose: async (confirmed: boolean) => {
          if (confirmed) await deleteNow(userId, messageId);
        },
      },
    });
  }

  // ── Reacting ────────────────────────────────────────────────────────

  // Changed at once and then replaced by what the server answers, so the chip
  // lights up on the click; put back as it was, with the reason, if refused.
  async function toggleReaction(bubble: Bubble, emojiValue: string) {
    setPickerFor(null);
    const to = activeId;
    const me = account?.id;
    const messageId = bubble.messageId;
    if (!to || !me || !messageId) return;
    const before = bubble.reactions;
    const on = !before.some((r) => r.emoji === emojiValue && r.users.includes(me));
    const isNew = !before.some((r) => r.emoji === emojiValue);
    if (on && isNew && before.length >= DM_MAX_REACTIONS_PER_MESSAGE) return;
    noteDmReactions(messageId, toggledReactions(before, emojiValue, me, on));
    const result = await reactToDirectMessage(to, messageId, emojiValue, on);
    if (result.ok) {
      noteDmReactions(messageId, result.reactions);
      return;
    }
    noteDmReactions(messageId, before);
    setError({ userId: to, value: result.error });
  }

  async function toggleReadReceipts() {
    if (!account) return;
    const next = !(myReadReceipts ?? true);
    setSettingsFailed(false);
    const held = await setDmReadReceipts(account.id, next);
    if (!held) {
      setSettingsFailed(true);
      return;
    }
    // Switched back on: how far the other side has read is the server's to
    // say again, and the open thread asks.
    if (next) setThreadSeq((n) => n + 1);
  }

  // ── Right button ────────────────────────────────────────────────────
  //
  // On a message: the quick reactions, then what its hover buttons do and
  // copying it. On a conversation: opening it, calling, marking it read. A
  // link inside a message keeps the browser's own menu.

  function messageMenu(event: ReactMouseEvent, bubble: Bubble) {
    if ((event.target as Element).closest("a[href]")) return;
    const me = account?.id ?? "";
    const delivered = Boolean(bubble.messageId);
    openContextMenu(event, {
      entries: [
        delivered && {
          type: "custom",
          render: (close) => (
            <div className="flex justify-between gap-0.5 px-1 pb-1">
              {QUICK_REACTIONS.map((emojiValue) => {
                const on = bubble.reactions.some((r) => r.emoji === emojiValue && r.users.includes(me));
                return (
                  <button
                    key={emojiValue}
                    type="button"
                    aria-pressed={on}
                    aria-label={t("groups.reactionPicker.reactWithEmoji", { emoji: emojiValue })}
                    onClick={() => {
                      close();
                      void toggleReaction(bubble, emojiValue);
                    }}
                    className={`flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg transition hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                      on ? "bg-blue-50 ring-1 ring-blue-500 dark:bg-blue-500/15" : ""
                    }`}
                  >
                    <Twemoji emoji={emojiValue} size={20} />
                  </button>
                );
              })}
            </div>
          ),
        },
        delivered && {
          label: t("directMessagesModal.react"),
          icon: <MdOutlineAddReaction className="h-4 w-4" />,
          onSelect: () => requestAnimationFrame(() => setPickerFor(`${bubble.messageId}:actions`)),
        },
        bubble.replyTarget && {
          label: t("common.reply"),
          icon: <MdReply className="h-4 w-4" />,
          onSelect: () => {
            if (!activeId) return;
            // One thing at a time in the box: an edit in progress is dropped.
            setEditing(null);
            setReply({ userId: activeId, value: bubble.replyTarget! });
            requestAnimationFrame(() => composerRef.current?.focus({ preventScroll: true }));
          },
        },
        canEdit(bubble) && {
          label: t("common.edit"),
          icon: <MdEdit className="h-4 w-4" />,
          onSelect: () => startEdit(bubble.messageId!, bubble.text),
        },
        bubble.status === "failed" &&
          bubble.clientId && {
            label: t("common.tryAgain2"),
            icon: <MdRefresh className="h-4 w-4" />,
            onSelect: () => retry(bubble.clientId!),
          },
        bubble.status === "failed" &&
          bubble.clientId && {
            label: t("common.discard"),
            icon: <MdClose className="h-4 w-4" />,
            danger: true,
            onSelect: () => discard(bubble.clientId!),
          },
        { type: "divider" },
        bubble.text && {
          label: t("groups.contextMenu.copyText"),
          icon: <MdContentCopy className="h-4 w-4" />,
          onSelect: () => void copyText(bubble.text),
        },
        bubble.messageId && {
          label: t("groups.contextMenu.copyMessageId"),
          icon: <MdContentCopy className="h-4 w-4" />,
          onSelect: () => void copyText(bubble.messageId!),
        },
        canDelete(bubble) && { type: "divider" },
        canDelete(bubble) && {
          label: t("common.delete"),
          icon: <MdDeleteOutline className="h-4 w-4" />,
          danger: true,
          onSelect: () => activeId && confirmDelete(activeId, bubble.messageId!),
        },
      ],
    });
  }

  function conversationMenu(event: ReactMouseEvent, conversation: Conversation) {
    const { user } = conversation;
    openContextMenu(event, {
      title: user.displayName,
      entries: [
        {
          label: t("dmMenu.openConversation"),
          icon: <MdChatBubbleOutline className="h-4 w-4" />,
          onSelect: () => openThread(user.id),
        },
        {
          label: t("common.callDisplayname", { displayName: user.displayName }),
          icon: <MdCall className="h-4 w-4" />,
          // Opens the thread too — a refusal is shown on its composer (see
          // placeCall), and there is otherwise nowhere on screen for it to
          // appear when the call was placed from the list.
          onSelect: () => {
            openThread(user.id);
            void placeCall(user.id);
          },
        },
        {
          label: t("groups.groupRail.markAsRead"),
          icon: <MdDoneAll className="h-4 w-4" />,
          disabled: conversation.unread === 0,
          onSelect: () => {
            markConversationRead(user.id);
            // The count is the server's to say; it is asked again at once.
            window.setTimeout(() => setListSeq((n) => n + 1), 300);
          },
        },
        { type: "divider" },
        { label: t("groups.memberMenu.copyId"), icon: <MdContentCopy className="h-4 w-4" />, onSelect: () => void copyText(user.id) },
      ],
    });
  }

  /** The thread's header: the person it is with. */
  function threadHeaderMenu(event: ReactMouseEvent) {
    if (!activeId || !active) return;
    openContextMenu(event, {
      title: active.displayName,
      entries: [
        {
          label: t("common.callDisplayname", { displayName: active.displayName }),
          icon: <MdCall className="h-4 w-4" />,
          onSelect: () => void placeCall(activeId),
        },
        wide && {
          label: expanded ? t("directMessagesModal.collapse") : t("directMessagesModal.expand"),
          icon: expanded ? <MdCloseFullscreen className="h-4 w-4" /> : <MdOpenInFull className="h-4 w-4" />,
          onSelect: () => setDirectMessagesExpanded(!expanded),
        },
        { type: "divider" },
        { label: t("groups.memberMenu.copyId"), icon: <MdContentCopy className="h-4 w-4" />, onSelect: () => void copyText(activeId) },
      ],
    });
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
  function openThread(userId: string) {
    if (userId === activeId) return;
    setScroll(null);
    openDirectMessages(userId);
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

  const selfId = account?.id ?? "";
  const meAuthor: Author | null = account
    ? {
        id: account.id,
        name: account.displayName,
        avatarUrl: account.avatarUrl ?? null,
        flags: account.flags,
        nameColor: account.equippedNameColor ?? null,
      }
    : null;
  const otherAuthor: Author | null = active
    ? {
        id: active.id,
        name: active.displayName,
        avatarUrl: active.avatarUrl ?? null,
        flags: active.flags,
        bot: active.bot,
        nameColor: active.nameColor ?? null,
      }
    : null;

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
        // Whatever the call is doing now, over what the page said when it
        // was read: a call goes on changing while it is on screen.
        call: message.call ? live.calls[message.id] ?? message.call : undefined,
        url: message.url,
        images: message.images,
        attachments: message.attachments,
        replyTo: message.replyTo,
        ts: message.ts,
        messageId: message.id,
        editedAt: message.editedAt,
        reactions: reactionsFor(message, live.reactions, loaded?.readAt ?? 0),
        seen: mine && seenTs !== null && message.ts <= seenTs,
        author: mine ? meAuthor : otherAuthor,
        replyTarget: {
          id: message.id,
          name: mine ? t("common.you") : active?.displayName ?? "",
          // Snapshotted from what is on screen. The API re-validates every
          // field before storing (see parseDmReplyTo).
          ...(message.text
            ? { text: message.text }
            : message.attachments?.length
              ? { text: attachmentsPreview(message.attachments) }
              : {}),
          // A call is not something to quote, and "call" is not one of the
          // kinds a quoted line can be.
          ...(message.kind && message.kind !== "call" ? { kind: message.kind } : {}),
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
        attachments: entry.payload.files,
        replyTo: entry.payload.replyTo,
        ts: entry.ts,
        status: entry.status,
        error: entry.error,
        reactions: [],
        seen: false,
        author: meAuthor,
      })
    ),
  ];

  // The rows' single "Visto": under the newest message of mine, once read.
  let seenLabelKey: string | null = null;
  for (let i = bubbles.length - 1; i >= 0; i -= 1) {
    if (!bubbles[i].mine) continue;
    if (bubbles[i].seen) seenLabelKey = bubbles[i].key;
    break;
  }

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
    if (bubble.call) {
      threadItems.push(
        <CallLine
          key={bubble.key}
          call={bubble.call}
          mine={bubble.mine}
          otherName={active?.displayName ?? t("common.someone")}
          ts={bubble.ts}
        />
      );
      return;
    }
    const grouped =
      !newDay &&
      previous.mine === bubble.mine &&
      bubble.ts - previous.ts < GROUP_GAP_MS &&
      // A reply in the rows restates who wrote it, the way the text room does.
      !(layout === "rows" && bubble.replyTo);
    threadItems.push(
      <MessageBubble
        key={bubble.key}
        bubble={bubble}
        grouped={grouped}
        layout={layout}
        selfId={selfId}
        otherName={active?.displayName ?? t("common.someone")}
        pickerFor={pickerFor}
        showSeenLabel={layout === "rows" && bubble.key === seenLabelKey}
        editing={Boolean(editingHere && bubble.messageId === editingHere.messageId)}
        onPicker={setPickerFor}
        onReact={(target, value) => void toggleReaction(target, value)}
        onEdit={canEdit(bubble) ? (target) => startEdit(target.messageId!, target.text) : undefined}
        onDelete={
          canDelete(bubble)
            ? (target, skipConfirm) => activeId && confirmDelete(activeId, target.messageId!, skipConfirm)
            : undefined
        }
        onReply={(target) => {
          if (!activeId) return;
          setEditing(null);
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
        onMenu={messageMenu}
      />
    );
  });
  // The rows say it in a line above the box instead (see threadPane).
  if (otherTyping && active && layout === "bubbles") {
    threadItems.push(<TypingBubble key="typing" label={formatTypingLabel([active.displayName])} />);
  }

  // An edit erased to nothing still goes: saving it asks whether to delete.
  const canSend =
    editingHere !== null ||
    draft.trim().length > 0 ||
    attached.length > 0 ||
    (filesHere.length > 0 && !uploads.uploading && !uploads.failed);
  const iconButton =
    "shrink-0 rounded-full p-2 text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-950 disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50";
  const headerButton =
    "shrink-0 rounded-full p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-100";

  // ── Header pieces ──

  const readReceiptsOn = myReadReceipts ?? true;
  const settingsButton = (
    <Popover
      open={settingsOpen}
      onClose={() => setSettingsOpen(false)}
      placement="bottom-end"
      tooltip={t("directMessagesModal.settings")}
      content={
        <div className="w-72 max-w-[calc(100vw-1.5rem)] rounded-xl border border-zinc-200 bg-white p-2 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
          <button
            type="button"
            role="switch"
            aria-checked={readReceiptsOn}
            disabled={myReadReceipts === null}
            onClick={() => void toggleReadReceipts()}
            className="flex w-full cursor-pointer items-start gap-3 rounded-lg p-2 text-left transition hover:bg-zinc-100 disabled:cursor-wait disabled:opacity-60 dark:hover:bg-zinc-900"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {t("directMessagesModal.readReceipts")}
              </span>
              <span className="mt-0.5 block text-xs leading-snug text-zinc-500 dark:text-zinc-400">
                {t("directMessagesModal.readReceiptsHint")}
              </span>
            </span>
            <span
              aria-hidden
              className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors ${
                readReceiptsOn ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-700"
              }`}
            >
              <span
                className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                  readReceiptsOn ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </span>
          </button>
          {settingsFailed && (
            <p className="px-2 pb-1 text-xs text-red-600 dark:text-red-400">{t("common.couldNotSave")}</p>
          )}
        </div>
      }
    >
      <button
        type="button"
        onClick={() => {
          setSettingsFailed(false);
          setSettingsOpen((current) => !current);
        }}
        aria-label={t("directMessagesModal.settings")}
        className={headerButton}
      >
        <MdSettings className="h-5 w-5" />
      </button>
    </Popover>
  );

  const expandButton = wide && (
    <button
      type="button"
      onClick={() => setDirectMessagesExpanded(!expanded)}
      aria-label={expanded ? t("directMessagesModal.collapse") : t("directMessagesModal.expand")}
      title={expanded ? t("directMessagesModal.collapse") : t("directMessagesModal.expand")}
      className={headerButton}
    >
      {expanded ? <MdCloseFullscreen className="h-5 w-5" /> : <MdOpenInFull className="h-[1.1rem] w-[1.1rem]" />}
    </button>
  );

  const closeButton = (
    <button type="button" onClick={close} aria-label={t("common.close")} title={t("common.close")} className={headerButton}>
      <MdClose className="h-5 w-5" />
    </button>
  );

  const threadIdentity =
    activeId && active ? (
      <div className="flex min-w-0 flex-1 items-center gap-2.5" onContextMenu={threadHeaderMenu}>
        <UserAvatar src={active.avatarUrl} name={active.displayName} size={34} userId={active.id} className="shrink-0" />
        <div className="min-w-0">
          <DisplayUserName
            name={active.displayName}
            verified={verifiedBadge(active.flags)}
            bot={active.bot}
            color={active.nameColor ?? null}
            className="block truncate text-sm font-semibold text-zinc-950 dark:text-zinc-50"
          />
          {otherTyping ? (
            <span className="block truncate text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
              {t("directMessagesModal.typing")}
            </span>
          ) : (
            <span className="block truncate text-[11px] text-zinc-500 dark:text-zinc-400">
              {presence ? presenceLabel(presence) : `@${active.username}`}
            </span>
          )}
        </div>
      </div>
    ) : (
      <h2 className="flex-1 truncate px-1 text-base font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
        {activeId ? t("common.loading") : split ? "" : t("common.messages")}
      </h2>
    );

  // Only inside a thread, and only once we know who it is with. The window
  // stays open on purpose — the ringing screen (see components/CallHost) draws
  // above it, and closing this would throw away the conversation the call came
  // out of.
  const callButton = activeId && active && (
    <button
      type="button"
      onClick={() => void placeCall(activeId)}
      aria-label={t("common.callDisplayname", { displayName: active.displayName })}
      title={t("common.callDisplayname", { displayName: active.displayName })}
      className="shrink-0 rounded-full p-1.5 text-emerald-600 transition hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
    >
      <MdCall className="h-5 w-5" />
    </button>
  );

  // Folds the lists beside a direct call away — this window's conversations
  // column and the rail of groups outside it — and brings them back. Only while
  // the call is actually on this thread and there is a row to fold: the narrow
  // window is one column at a time, and folding the only one would leave an
  // empty screen. The lists come back on their own when the call ends (see
  // lib/dmCallColumns), so this is never a state to get stuck in.
  //
  // Two buttons rather than one that changes its icon, because the two live in
  // different places — the room's own rule (see WatchRoom's left sidebar). The
  // one that folds sits with the list it folds, beside the conversations'
  // settings; the one that brings it back cannot, because by then that header
  // has gone with the column, so it waits in the thread's own bar.
  const foldable = split && callHere;
  const hideListsButton = foldable && !columnsCollapsed && (
    <Tooltip content={t("directMessagesModal.hideTheLists")} placement="bottom">
      <button
        type="button"
        onClick={toggleDmCallColumns}
        aria-label={t("directMessagesModal.hideTheLists")}
        className={`cursor-pointer ${headerButton}`}
      >
        <LuPanelLeftClose className="h-5 w-5" />
      </button>
    </Tooltip>
  );
  const showListsButton = foldable && columnsCollapsed && (
    <Tooltip content={t("directMessagesModal.showTheLists")} placement="bottom">
      <button
        type="button"
        onClick={toggleDmCallColumns}
        aria-label={t("directMessagesModal.showTheLists")}
        className={`cursor-pointer ${headerButton}`}
      >
        <LuPanelLeftOpen className="h-5 w-5" />
      </button>
    </Tooltip>
  );

  const headerRow = "flex shrink-0 items-center gap-1.5 border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800";

  // ── The list ──

  const listPane = (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
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
            const { user, lastMessage } = conversation;
            const selected = split && user.id === activeId;
            // The open conversation is being read as it is looked at; its
            // count going to zero is the server's next answer, drawn now.
            const unread = selected ? 0 : conversation.unread;
            const mine = lastMessage.from === account?.id;
            const line = messageSummary(lastMessage);
            const typing = Boolean(live.typing[user.id]);
            return (
              <li key={user.id}>
                <button
                  type="button"
                  onClick={() => openThread(user.id)}
                  onContextMenu={(e) => conversationMenu(e, conversation)}
                  aria-current={selected ? "true" : undefined}
                  className={`flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition ${
                    selected ? "bg-zinc-100 dark:bg-zinc-900" : "hover:bg-zinc-100 dark:hover:bg-zinc-900"
                  }`}
                >
                  <UserAvatar src={user.avatarUrl} name={user.displayName} size={40} userId={user.id} className="shrink-0" />
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
                          unread > 0 ? "font-semibold text-emerald-600 dark:text-emerald-400" : "text-zinc-400"
                        }`}
                      >
                        {listTimeLabel(lastMessage.ts, now)}
                      </span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-2">
                      {typing ? (
                        <span className="min-w-0 flex-1 truncate text-xs font-medium text-emerald-600 dark:text-emerald-400">
                          {t("directMessagesModal.typing")}
                        </span>
                      ) : (
                        <span
                          className={`min-w-0 flex-1 truncate text-xs ${
                            unread > 0
                              ? "font-medium text-zinc-800 dark:text-zinc-200"
                              : "text-zinc-500 dark:text-zinc-400"
                          }`}
                        >
                          {mine ? t("directMessagesModal.youLine", { line }) : line}
                        </span>
                      )}
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
  );

  // ── One thread ──

  // The call with the person whose thread this is, drawn above their messages
  // — a call is part of the conversation, not a place you are sent to (see
  // lib/callSession's `dm`). The room itself is mounted at the root of the app
  // and merely moved in here (components/CallOutlet), so it goes on whether or
  // not this window is the page on screen.
  const callPane = callHere ? (
    <div className="flex min-h-[12rem] flex-[2] flex-col overflow-hidden border-b border-zinc-200 p-2 dark:border-zinc-800">
      <CallOutlet />
    </div>
  ) : callInvite && active ? (
    <DmCallInvite
      name={active.displayName}
      avatarUrl={active.avatarUrl ?? null}
      ringing={callInvite === "ringing"}
      busy={answering}
      onAnswer={() => void answerHere()}
      onDecline={declineHere}
      onJoin={joinHere}
    />
  ) : null;

  const threadPane = (
    <>
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          // Anchoring off: this component keeps the reading position itself
          // when history goes in above, and the browser doing it too would
          // move the line twice.
          className={`h-full overflow-y-auto overscroll-contain py-3 [overflow-anchor:none] ${split ? "px-4" : "px-3"}`}
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
          ) : bubbles.length === 0 && !otherTyping ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              {active && <UserAvatar src={active.avatarUrl} name={active.displayName} size={64} userId={active.id} />}
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

      {split && otherTyping && active && (
        // The text room's line (see TextChannelView). The bubbles have their
        // own dots in the thread instead.
        <p aria-live="polite" className="shrink-0 truncate px-4 pt-1.5 text-xs italic text-zinc-500">
          {formatTypingLabel([active.displayName])}
        </p>
      )}

      {editingHere && (
        <div className="flex shrink-0 items-center gap-2 border-t border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          <MdEdit className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium">{t("groups.groupMessageComposer.editing")}</span>
            {/* Keys mean nothing on a phone's keyboard; the tick is how it saves there. */}
            {!isCoarsePointer() && (
              <span className="text-amber-700/70 dark:text-amber-300/60"> · {t("groups.groupMessageComposer.editHint")}</span>
            )}
          </span>
          <button
            type="button"
            onClick={() => setEditing(null)}
            aria-label={t("groups.groupMessageComposer.cancelEdit")}
            className="shrink-0 rounded-full p-1 hover:bg-amber-100 dark:hover:bg-amber-500/20"
          >
            <MdClose className="h-4 w-4" />
          </button>
        </div>
      )}

      {replyingTo && !editingHere && (
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

      {attached.length > 0 && !editingHere && (
        // A tray above the box rather than an immediate send, exactly as the
        // room chat does it: a caption can then be written to go with the
        // pictures instead of arriving as a second message.
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

      {filesHere.length > 0 && !editingHere && (
        <AttachmentTray
          items={filesHere}
          onRemove={uploads.remove}
          className="shrink-0 border-t border-zinc-200 px-3 py-2 dark:border-zinc-800"
        />
      )}

      {(shownError || (filesFor === activeId && uploads.error)) && (
        <p className="shrink-0 px-4 pt-2 text-xs text-red-600 dark:text-red-400">
          {shownError || uploads.error}
        </p>
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
        {/* An edit changes the words only: nothing to attach, and a GIF
            picked here would go out as a new message. */}
        {!editingHere && (
          <AttachMenu
            onImages={(files) => {
              const list = new DataTransfer();
              for (const file of files) list.items.add(file);
              void handleFiles(list.files);
            }}
            onFiles={handleAnyFiles}
            onOpen={() => void uploads.refreshLimit()}
            limitMb={uploads.limit?.maxMb}
            buttonClassName={iconButton}
            iconClassName="h-5 w-5"
          />
        )}
        <textarea
          ref={composerRef}
          rows={1}
          value={boxText}
          onChange={(e) => {
            if (!activeId) return;
            const { text } = emoji.handleChange(e.target.value, e.target.selectionStart ?? e.target.value.length);
            setBoxText(activeId, text);
            // Changing a message already sent is not writing a new one.
            if (!editingHere) announceTyping(activeId, text);
          }}
          onKeyDown={handleComposerKey}
          onKeyUp={emoji.sync}
          onClick={emoji.sync}
          onFocus={emoji.prefetch}
          // Only takes over the paste when the clipboard really carries an
          // image: a copied <img> from a web page arrives as image data *and*
          // HTML, and pasting plain text has to keep working untouched. Same
          // rule the room chat uses.
          onPaste={(e) => {
            // An edit changes words only; a pasted picture has nowhere to go.
            if (editingHere) return;
            const files = Array.from(e.clipboardData?.files ?? []).filter((file) => file.type.startsWith("image/"));
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
        {!editingHere && (
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
                  // Sent on its own, as the room chat does: a GIF is the
                  // message, not an attachment to one.
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
        )}
        <EmojiPickerButton onPick={emoji.insert} className={iconButton} />
        <button
          type="submit"
          disabled={!canSend}
          aria-label={editingHere ? t("common.save") : t("common.send")}
          title={editingHere ? t("common.save") : t("directMessagesModal.sendEnter")}
          className="shrink-0 rounded-full bg-zinc-950 p-2.5 text-white transition hover:bg-zinc-800 disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
        >
          {editingHere ? <MdCheck className="h-5 w-5" /> : <MdSend className="h-5 w-5" />}
        </button>
      </form>
    </>
  );

  const dialogLabel = active
    ? t("directMessagesModal.conversationWithDisplayname", { displayName: active.displayName })
    : t("common.messages");

  return createPortal(
    <>
      {split ? (
        // The whole screen, laid out like a group's text room: the
        // conversations as a column of their own, the thread beside them.
        <div
          role={docked ? "region" : "dialog"}
          aria-modal={docked ? undefined : "true"}
          aria-label={dialogLabel}
          className={
            docked
              ? "flex min-h-0 min-w-0 flex-1 select-none gap-3"
              : "fixed inset-0 z-50 flex select-none gap-3 bg-zinc-50 p-3 dark:bg-black"
          }
        >
          {/* Hidden rather than unmounted while a call folds it away: the list
              comes back scrolled where it was left, and its conversations are
              not re-read for the sake of a button press. */}
          <aside
            ref={setListColumn}
            style={listColumnStyle}
            className={`relative shrink-0 flex-col ${listFolded ? "hidden" : "flex"}`}
          >
            <ColumnResizeHandle {...listColumnHandle} label={t("groups.groupAppShell.dragToResizeColumn")} />
            {/* The card, inside the column rather than being it: the grip sits
                in the gap on the column's edge, and a card that clipped its
                overflow would clip the grip away with it. */}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
              <div className={headerRow}>
                <MdChatBubbleOutline className="ml-1 h-5 w-5 shrink-0 text-zinc-500" />
                <h2 className="flex-1 truncate px-1 text-base font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                  {t("common.messages")}
                </h2>
                {hideListsButton}
                {settingsButton}
              </div>
              {listPane}
            </div>
          </aside>
          <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
            <div className={headerRow}>
              {threadIdentity}
              {showListsButton}
              {callButton}
              {expandButton}
              {closeButton}
            </div>
            {callPane}
            {activeId ? (
              threadPane
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                  <MdChatBubbleOutline className="h-7 w-7" />
                </span>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("directMessagesModal.pickAConversation")}</p>
              </div>
            )}
          </section>
        </div>
      ) : (
        <div
          className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/50 sm:items-center sm:p-4"
          onPointerDown={handleBackdropPointerDown}
          onClick={handleBackdropClick}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={dialogLabel}
            // Full screen on a phone, where a floating card is mostly margin and
            // the keyboard would cover half of it; a card from `sm` up.
            // Only the messages and the box select text — see the select-text on them.
            className="flex h-dvh w-full select-none flex-col overflow-hidden bg-white shadow-2xl sm:h-[min(52rem,90dvh)] sm:max-w-xl sm:rounded-2xl sm:border sm:border-black/10 dark:bg-zinc-950 sm:dark:border-white/10"
          >
            <div className={headerRow}>
              {activeId && (
                <button
                  type="button"
                  onClick={backToList}
                  aria-label={t("directMessagesModal.backToTheConversations")}
                  title={t("common.back")}
                  className={headerButton}
                >
                  <MdArrowBack className="h-5 w-5" />
                </button>
              )}
              {threadIdentity}
              {callButton}
              {!activeId && settingsButton}
              {expandButton}
              {closeButton}
            </div>
            {listVisible ? (
              listPane
            ) : (
              <>
                {callPane}
                {threadPane}
              </>
            )}
          </div>
        </div>
      )}
      {/* Outside the backdrop, not inside it. React delivers a click inside a
          portal to the portal's parents in the component tree, so while this
          lived in the backdrop every click on the enlarged picture — including
          the one that closes it — also closed the whole conversation. */}
      <ChatImageModal preview={imageModalPreview} onClose={() => setImageModalPreview(null)} />
    </>,
    docked && outlet ? outlet : document.body
  );
}

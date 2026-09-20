"use client";

import { useAuraOf } from "@/components/groups/AuraMark";
import { MessageAttachments } from "@/components/MessageAttachments";
import { InviteEmbeds } from "@/components/groups/InviteEmbed";
import { ChatImages } from "@/components/ChatImages";
import { attachmentsPreview } from "@/lib/chatAttachments";
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import useNtPopups from "ntpopups";
import {
  MdAlternateEmail,
  MdAutoAwesome,
  MdChatBubbleOutline,
  MdClose,
  MdContentCopy,
  MdDeleteOutline,
  MdEdit,
  MdEmojiEmotions,
  MdLink,
  MdOpenInNew,
  MdOutlineAddReaction,
  MdPeopleOutline,
  MdPushPin,
  MdRefresh,
  MdReply,
  MdSearch,
  MdSettings,
  MdVolumeUp,
} from "react-icons/md";
import { ChatImageModal, type ChatImagePreviewState } from "@/components/ChatImageModal";
import { DisplayUserName } from "@/components/DisplayUserName";
import { Popover, Tooltip } from "@/components/Tooltip";
import { UserAvatar } from "@/components/UserAvatar";
import {
  EVERYONE_CANDIDATE,
  GroupMessageComposer,
  MENTION_BUILDER_CANDIDATE,
  OFFLINE_CANDIDATE,
  ONLINE_CANDIDATE,
  type ComposerHandle,
  type ComposerPayload,
  type ComposerRole,
  type MentionCandidate,
} from "@/components/groups/GroupMessageComposer";
import { MentionBuilderDialog, describeMention, type BuilderRole } from "@/components/groups/MentionBuilderDialog";
import { clickPerson, contextPerson } from "@/components/groups/groupProfile";
import { QUICK_REACTIONS, ReactionPicker } from "@/components/groups/ReactionPicker";
import { ReactionsDialog } from "@/components/groups/ReactionsDialog";
import { useOpenChannelSettings } from "@/components/groups/ChannelSettingsDialog";
import { copyText } from "@/lib/clipboard";
import { SwipeReplyHint } from "@/components/SwipeReplyHint";
import { openContextMenu } from "@/lib/contextMenu";
import { useMessageGestures, type MessageGestures } from "@/lib/messageGestures";
import { mentionInComposer } from "@/lib/groupMentionBridge";
import { Twemoji } from "@/components/Twemoji";
import { rememberChannel } from "@/components/groups/lastChannel";
import { groupDraftKey } from "@/lib/composerDrafts";
import { mentionsRegexFor, normalizeSearch, tokenizeMentions } from "@/lib/chatMentions";
import { findMentionExprs, mentionsTakeIn, typedAtomResolver } from "@/lib/mentionExpr";
import {
  EVERYONE_MENTION,
  OFFLINE_MENTION,
  ONLINE_MENTION,
  ROLE_MENTION_PREFIX,
  canInChannel,
  canManage,
  memberCanInChannel,
  membersRevalidateKey,
  roleColorOf,
  rolesInOrder,
  type TextPermissionKey,
} from "@/lib/groupPermissions";
import { verifiedBadge } from "@/lib/entitlements";
import {
  getCachedChannel,
  loadLatestMessages,
  putCachedChannel,
  useOnlineGroupMembers,
} from "@/lib/groupCache";
import {
  deleteGroupMessage,
  editGroupMessage,
  fetchMessages,
  fetchPinnedMessages,
  reactToGroupMessage,
  searchGroupMessages,
  searchMembers,
  setGroupMessagePinned,
  sendGroupTyping,
  WEBHOOK_AUTHOR_PREFIX,
  type GroupDetail,
  type GroupMessage,
  type GroupReaction,
  type GroupReplyTo,
  type GroupUser,
} from "@/lib/groupsApi";
import { describeReaction, toggleReaction as toggledReactions } from "@/lib/groupReactions";
import { signalingClient } from "@/lib/signalingClient";
import { TYPING_REFRESH_MS, formatTypingLabel } from "@/lib/typing";
import {
  onGroupMessage,
  onGroupMessageDeleted,
  onGroupMessageReactions,
  onGroupMessageUpdated,
  onGroupTyping,
  setViewingChannel,
} from "@/lib/useGroups";
import {
  discardGroupMessage,
  queueGroupMessage,
  retryGroupMessage,
  useOutbox,
  type OutgoingMessage,
} from "@/lib/groupOutbox";
import { prefetchUserProfile } from "@/lib/userProfile";
import { useGroupNavigation } from "@/lib/groupNavigation";
import { groupPath } from "@/lib/groupLinks";
import { UNKNOWN_ROOM, UNKNOWN_USER, plainTokens, splitTokens, type Named } from "@/lib/messageTokens";
import { stripMarkdown } from "@/lib/markdown";
import { Markdown } from "@/components/Markdown";
import { MessageEmbeds } from "@/components/MessageEmbeds";
import { useT } from "@/lib/useI18n";
import { MessageFinderPanel, type FinderRow } from "@/components/MessageFinderPanel";
import { NewBadge, markFeatureUsed } from "@/components/NewBadge";
import {
  MESSAGE_FINDER_EVENTS,
  MESSAGE_FINDER_FEATURE,
  MESSAGE_LINK_PARAM,
  clearMessageFinder,
  groupMessageLink,
  takeLinkedMessageId,
  trackFinderEvent,
  useMessageFinder,
  useMessageFinderRequest,
  type FinderPanel,
} from "@/lib/messageFinder";
import { translate } from "@/lib/i18n";
import { formatLocale } from "@/lib/i18n";
import { isPageInFront } from "@/lib/pageFocus";

// One text room of a group: its history, read a page at a time and extended
// live, and the box to write in. Drawn as a panel in the same family as the
// room's chat (components/ChatPanel) — small face beside the name, a run of
// lines from one person under one header, a mention lit in blue — because it
// is the same kind of conversation, just one that stays after everybody leaves.
//
// Opens from lib/groupCache when the room was read before — at once, scrolled
// to the bottom — and re-reads the newest page behind that, so switching
// between rooms never shows a skeleton for something already seen.

const GROUP_GAP_MS = 5 * 60 * 1000;
const NEAR_BOTTOM_PX = 96;
const NEAR_TOP_PX = 80;
// How long somebody stays in the "digitando..." line with nothing more heard
// from them. A writer re-announces every TYPING_REFRESH_MS (see lib/typing),
// and the margin on top is for the request that carries it — so this only
// ever runs out when a "stopped" was lost: a closed tab, a dropped connection.
const TYPING_EXPIRE_MS = TYPING_REFRESH_MS + 3000;
// How many live messages this room keeps mounted. Above groupCache's own
// MAX_MESSAGES_PER_CHANNEL, so what gets stored for the next visit is decided
// there as before and this only bounds what is on screen right now.
const MAX_LIVE_MESSAGES = 400;
// People kept from @-searches so their names are at hand — see `found`.
const MAX_FOUND = 200;
// How far back "ir para a mensagem respondida" reads looking for the original,
// in pages of 50, before it says it could not find it.
const JUMP_MAX_PAGES = 20;

function timeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString(formatLocale(), { hour: "2-digit", minute: "2-digit" });
}

/** When a message was edited, for the "(editado)" hover: the day and the time. */
function editedLabel(ts: number): string {
  return new Date(ts).toLocaleString(formatLocale(), {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(ts: number): string {
  const now = Date.now();
  if (dayKey(ts) === dayKey(now)) return translate("common.today");
  if (dayKey(ts) === dayKey(now - 86_400_000)) return translate("common.yesterday");
  return new Date(ts).toLocaleDateString(formatLocale(), { weekday: "long", day: "numeric", month: "long" });
}

const LINK_SPLIT = /(https?:\/\/[^\s]+|www\.[^\s]+)/g;
const LINK_TEST = /^(?:https?:\/\/|www\.)/;

function linkify(text: string, keyPrefix: string): ReactNode[] {
  return text.split(LINK_SPLIT).map((part, index) => {
    if (!LINK_TEST.test(part)) return <Fragment key={`${keyPrefix}-${index}`}>{part}</Fragment>;
    const href = part.startsWith("www.") ? `https://${part}` : part;
    return (
      <a
        key={`${keyPrefix}-${index}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        // Blue and unadorned, underlined only on hover — the colour is what
        // says "link" in a chat, and a permanent underline under every URL in
        // a busy conversation is noise. Same blue as a mention, which is
        // already the colour of everything clickable inside a message.
        className="break-all text-blue-600 hover:underline hover:underline-offset-2 dark:text-blue-400"
      >
        {part}
      </a>
    );
  });
}

/** A message still on its way, drawn as the message it will be (see lib/groupOutbox). */
function outgoingAsMessage(outgoing: OutgoingMessage, selfId: string): GroupMessage {
  return {
    id: `out:${outgoing.nonce}`,
    groupId: outgoing.groupId,
    channelId: outgoing.channelId,
    from: selfId,
    fromName: "",
    text: outgoing.text,
    kind: outgoing.url ? "gif" : outgoing.images?.length ? "image" : "text",
    ...(outgoing.url ? { url: outgoing.url } : {}),
    ...(outgoing.images ? { images: outgoing.images } : {}),
    ...(outgoing.files ? { attachments: outgoing.files } : {}),
    replyTo: outgoing.replyTo,
    mentions: outgoing.mentions,
    ts: outgoing.ts,
  };
}

/** The room header's own icon buttons — lit while the panel they open is up. */
function headerButton(active: boolean): string {
  return `relative flex shrink-0 cursor-pointer items-center rounded-lg p-1.5 transition ${
    active
      ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
      : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
  }`;
}

const rowAction =
  "inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-zinc-400 opacity-100 transition hover:bg-zinc-200/70 hover:text-zinc-800 active:scale-95 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200";

// One reaction under a message: its emoji and its count, in a small pill.
// The shape only — each state below brings its own colours. Two border (or
// background) colours on one element do not override each other by their
// order in the class list: whichever the stylesheet happens to put last wins,
// which is how a reaction of yours used to stay grey instead of turning blue.
const reactionChip = "inline-flex h-6 items-center gap-1 rounded-md border px-1.5 text-xs font-medium transition";
/** A reaction you are not on, and the "+" beside them. */
const reactionChipIdle =
  "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300";
/** A reaction you are on — Discord's blue border and background. */
const reactionChipMine =
  "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-500/15 dark:text-blue-300";

type RowContext = Record<string, unknown>;

/**
 * One message in the log, memoised.
 *
 * `draw` is the room's own drawing function from the current render, so a
 * line that does redraw reads everything as it stands now. The comparison
 * deliberately leaves `draw` out — it is a new function every render — and
 * redraws only for what can change a line: its message (a reaction or an
 * edit replaces the object), its place in a run, being edited, its picker,
 * and `context`, which carries what all lines share. Without this every new
 * message redrew all of the up to MAX_LIVE_MESSAGES lines before it.
 */
const MessageRow = memo(
  function MessageRow({
    draw,
    message,
    outgoing,
    grouped,
    onReply,
    onMenu,
  }: {
    draw: (
      message: GroupMessage,
      outgoing: OutgoingMessage | undefined,
      grouped: boolean,
      gestures: MessageGestures
    ) => ReactNode;
    message: GroupMessage;
    outgoing: OutgoingMessage | undefined;
    grouped: boolean;
    editing: boolean;
    picker: string | null;
    context: RowContext;
    /** Dragged to the left; absent for a line there is nothing to answer. */
    onReply?: () => void;
    /** Held, and the right button on a desktop. */
    onMenu?: (event: React.MouseEvent) => void;
  }) {
    // Here rather than in the room's drawing function, which is a plain
    // function called in a loop and so no place for a hook.
    const gestures = useMessageGestures({ onReply, onMenu });
    return <>{draw(message, outgoing, grouped, gestures)}</>;
  },
  (a, b) =>
    a.message === b.message &&
    a.outgoing === b.outgoing &&
    a.grouped === b.grouped &&
    a.editing === b.editing &&
    a.picker === b.picker &&
    a.context === b.context
);

// Memoised: its parent re-renders on every change to the group, and this is
// the heaviest thing on a group's page (up to MAX_LIVE_MESSAGES lines of
// markdown, mentions and embeds). See GroupRoom's `textDetail`.
export const TextChannelView = memo(function TextChannelView({
  detail,
  channelId,
}: {
  detail: GroupDetail;
  channelId: string;
}) {
  const t = useT();
  const { openPopup } = useNtPopups();
  const groupId = detail.group.id;
  const channel = detail.channels.find((c) => c.id === channelId) ?? null;
  const selfId = detail.me.id;
  // Deleting somebody else's message is "Gerenciar mensagens" (see lib/groupPermissions).
  const canManageMessages = canManage(detail, "manageMessages");
  // Pins, search and message links — one experiment (see lib/messageFinder).
  const finder = useMessageFinder();
  const [finderPanel, setFinderPanel] = useState<FinderPanel | null>(null);
  // Bumped whenever a message in this room changed, so the pinned list reads
  // itself again: somebody else pinning something arrives as an ordinary
  // message update, and the list is a server answer rather than a slice of
  // what this component holds.
  const [pinsSeq, setPinsSeq] = useState(0);
  // Whether the search covers the whole group or only this room. The group is
  // the default: somebody looking for something said "in here" rarely
  // remembers which room it was in.
  const [searchWholeGroup, setSearchWholeGroup] = useState(true);

  function openFinder(panel: FinderPanel) {
    setFinderPanel(panel);
    markFeatureUsed(MESSAGE_FINDER_FEATURE);
    trackFinderEvent(
      panel === "pins" ? MESSAGE_FINDER_EVENTS.pinsOpen : MESSAGE_FINDER_EVENTS.searchOpen,
      groupId
    );
  }

  // A phone's room bar is several components away from this one, so its menu
  // asks through the store rather than through a prop (see lib/messageFinder).
  const finderRequest = useMessageFinderRequest();
  useEffect(() => {
    if (!finderRequest || finderRequest.scopeId !== channelId) return;
    clearMessageFinder();
    openFinder(finderRequest.panel);
    // openFinder is remade every render and is not what decides this — the
    // request arriving is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finderRequest, channelId]);

    // Which custom emoji the composer and the reaction picker offer here.
  const emojiPlace = useMemo(() => ({ group: groupId, channel: channelId }), [groupId, channelId]);
  // "Farmando aura": the mark after an author's name (see AuraMark).
  const auraOf = useAuraOf(detail);

  // Whatever was held for this room from last time. Read once: this component
  // is keyed by the room, so a new room is a new instance and a fresh read.
  const [cached] = useState(() => (detail.chatAvailable ? getCachedChannel(channelId) : null));
  const [messages, setMessages] = useState<GroupMessage[] | null>(cached?.messages ?? null);
  const [authors, setAuthors] = useState<Record<string, GroupUser>>(cached?.authors ?? {});
  const [hasMore, setHasMore] = useState(cached?.hasMore ?? true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [replyTo, setReplyTo] = useState<GroupReplyTo | null>(null);
  // What this browser sent here and the server has not confirmed yet —
  // shown at the bottom, as the messages they will be.
  const outbox = useOutbox(channelId);
  const [preview, setPreview] = useState<ChatImagePreviewState | null>(null);
  const [unseen, setUnseen] = useState(0);
  // The reaction picker that is open, as "<message id>:<where>" — each message
  // has two ways in (its hover actions and the "+" at the end of its
  // reactions), and only the one clicked opens.
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  // "Ver reações" — which message, opened on which emoji (null for its first).
  const [reactionsView, setReactionsView] = useState<{ messageId: string; emoji: string | null } | null>(null);
  // The composer, for opening a message in it to edit — and which one it has
  // open, so that line can be marked while it is.
  const composerRef = useRef<ComposerHandle | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const atBottomRef = useRef(true);
  const olderInFlight = useRef(false);
  const pendingScroll = useRef<
    | { type: "bottom" }
    | { type: "preserve"; height: number; top: number }
    | { type: "message"; id: string }
    | null
  >(
    cached ? { type: "bottom" } : null
  );

  // ── Loading ──────────────────────────────────────────────────────────

  // The newest page, folded into whatever was held (see loadLatestMessages).
  useEffect(() => {
    if (!detail.chatAvailable) return;
    let cancelled = false;
    void loadLatestMessages(groupId, channelId).then((entry) => {
      if (cancelled) return;
      if (!entry) {
        // Nothing held and nothing read: say so. With a cached page on
        // screen, a failed refresh is not worth replacing it with an error.
        setMessages((prev) => {
          if (prev === null) setLoadError(t("groups.textChannelView.couldNotLoadTheMessages"));
          return prev ?? [];
        });
        return;
      }
      if (atBottomRef.current) pendingScroll.current = { type: "bottom" };
      setMessages(entry.messages);
      setAuthors((prev) => ({ ...prev, ...entry.authors }));
      setHasMore(entry.hasMore);
    });
    return () => {
      cancelled = true;
    };
  }, [groupId, channelId, detail.chatAvailable, t]);

  // Everything this room holds goes back into the cache as it changes, so the
  // next visit opens on exactly what was on screen when this one ended.
  useEffect(() => {
    if (!messages || !detail.chatAvailable || loadError) return;
    const held = getCachedChannel(channelId);
    putCachedChannel(channelId, { messages, authors, hasMore, fetchedAt: held?.fetchedAt ?? Date.now() });
  }, [channelId, messages, authors, hasMore, detail.chatAvailable, loadError]);

  // Who is online, shared with the members column. This used to be the whole
  // membership — every member, loaded here just so @-suggestions and names
  // had somebody to draw from. Messages now carry who they mention as ids
  // (see lib/messageTokens), the API names them alongside, and anybody else
  // is found by searching as their name is typed.
  const onlineEntry = useOnlineGroupMembers(groupId, membersRevalidateKey(detail));
  // People a search turned up, so one picked from it is drawn by name the
  // moment the message is sent, before the API's echo brings the name back.
  const [found, setFound] = useState<Record<string, GroupUser>>({});
  const navigation = useGroupNavigation();

  const loadOlder = useCallback(async () => {
    if (olderInFlight.current || !hasMore || !messages || messages.length === 0) return;
    olderInFlight.current = true;
    setLoadingOlder(true);
    const result = await fetchMessages(groupId, channelId, messages[0].ts).catch(() => null);
    olderInFlight.current = false;
    setLoadingOlder(false);
    if (!result || !result.ok) return;
    const el = scrollRef.current;
    if (el) pendingScroll.current = { type: "preserve", height: el.scrollHeight, top: el.scrollTop };
    setHasMore(result.messages.length >= 50);
    setAuthors((prev) => ({ ...prev, ...result.authors }));
    setMessages((prev) => {
      const known = new Set((prev ?? []).map((m) => m.id));
      return [...result.messages.filter((m) => !known.has(m.id)), ...(prev ?? [])];
    });
  }, [groupId, channelId, hasMore, messages]);

  // ── Live ─────────────────────────────────────────────────────────────

  const upsert = useCallback(
    (message: GroupMessage) => {
      setMessages((prev) => {
        if (!prev) return prev;
        const last = prev[prev.length - 1];
        // A message arriving after the newest one held is the overwhelmingly
        // common case, and it needs neither the duplicate scan nor the sort:
        // both were being paid on every single arrival, over a list with no
        // upper bound. The out-of-order path below is unchanged.
        if (last && message.ts >= last.ts && message.id !== last.id) {
          if (atBottomRef.current) pendingScroll.current = { type: "bottom" };
          else if (message.from !== selfId) setUnseen((n) => n + 1);
          const next = [...prev, message];
          // A channel left open all day otherwise holds every message it ever
          // saw, each one a mounted subtree. Only trimmed while there is
          // known-older history on the server, because that is what makes the
          // dropped ones recoverable — scrolling up calls loadOlder, which
          // fetches by cursor from whatever is now the first message.
          return hasMore && next.length > MAX_LIVE_MESSAGES
            ? next.slice(next.length - MAX_LIVE_MESSAGES)
            : next;
        }
        if (prev.some((m) => m.id === message.id)) return prev;
        if (atBottomRef.current) pendingScroll.current = { type: "bottom" };
        else if (message.from !== selfId) setUnseen((n) => n + 1);
        return [...prev, message].sort((a, b) => a.ts - b.ts);
      });
    },
    [selfId, hasMore]
  );

  // Who else is writing here right now: their name by id, each with a timer
  // that takes them off after TYPING_EXPIRE_MS unless they are heard from
  // again. This component is keyed by the room, so a new room starts empty.
  const [typers, setTypers] = useState<Record<string, string>>({});
  const typerTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dropTyper = useCallback((userId: string) => {
    const timers = typerTimers.current;
    const timer = timers.get(userId);
    if (timer) clearTimeout(timer);
    timers.delete(userId);
    setTypers((prev) => {
      if (!(userId in prev)) return prev;
      const next = { ...prev };
      delete next[userId];
      return next;
    });
  }, []);

  useEffect(
    () =>
      onGroupTyping((event) => {
        if (event.groupId !== groupId || event.channelId !== channelId || event.userId === selfId) return;
        if (!event.typing) {
          dropTyper(event.userId);
          return;
        }
        const timers = typerTimers.current;
        const existing = timers.get(event.userId);
        if (existing) clearTimeout(existing);
        timers.set(
          event.userId,
          setTimeout(() => dropTyper(event.userId), TYPING_EXPIRE_MS)
        );
        setTypers((prev) => (prev[event.userId] === event.name ? prev : { ...prev, [event.userId]: event.name }));
      }),
    [groupId, channelId, selfId, dropTyper]
  );

  useEffect(() => {
    const timers = typerTimers.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  useEffect(
    () =>
      onGroupMessage((message, author, _nonce, mentioned) => {
        if (message.groupId !== groupId || message.channelId !== channelId) return;
        // The people it mentions come with it, so the mention can be drawn with
        // their name even when they are nobody this room has seen yet.
        const named = mentioned && Object.keys(mentioned).length > 0 ? mentioned : null;
        if (author || named) {
          setAuthors((prev) => ({ ...named, ...prev, ...(author ? { [author.id]: author } : {}) }));
        }
        // What they were typing just arrived — the line goes with it, the way
        // it does everywhere else, rather than lingering until it times out.
        dropTyper(message.from);
        upsert(message);
      }),
    [groupId, channelId, upsert, dropTyper]
  );

  useEffect(
    () =>
      onGroupMessageReactions((event) => {
        if (event.channelId !== channelId) return;
        setMessages(
          (prev) => prev?.map((m) => (m.id === event.messageId ? { ...m, reactions: event.reactions } : m)) ?? prev
        );
      }),
    [channelId]
  );

  useEffect(
    () =>
      onGroupMessageDeleted((event) => {
        if (event.channelId !== channelId) return;
        // Deleted while it was open for editing — by a moderator, or on
        // another device: there is nothing left to save the edit to.
        composerRef.current?.cancelEdit(event.messageId);
        setMessages((prev) => prev?.filter((m) => m.id !== event.messageId) ?? prev);
      }),
    [channelId]
  );

  useEffect(
    () =>
      onGroupMessageUpdated(({ message, mentioned }) => {
        if (message.channelId !== channelId) return;
        if (Object.keys(mentioned).length > 0) setAuthors((prev) => ({ ...mentioned, ...prev }));
        // Cheap, and only read while the pinned list is open (see its effect).
        setPinsSeq((n) => n + 1);
        // Only what an edit changes — the reactions held may be newer.
        setMessages(
          (prev) =>
            prev?.map((m) =>
              m.id === message.id
                ? // pingedMe was the answer for the old mentions; the new ones
                  // are worked out here, as for a message just arrived.
                  {
                    ...m,
                    text: message.text,
                    mentions: message.mentions,
                    editedAt: message.editedAt,
                    // A pin arrives as an ordinary update, because that is
                    // what it is: the same message, differently marked.
                    pinnedAt: message.pinnedAt,
                    pinnedBy: message.pinnedBy,
                    pingedMe: undefined,
                  }
                : m
            ) ?? prev
        );
      }),
    [channelId]
  );

  // This room is the one on screen — nothing in it is unread, here or on any
  // other device — and the group should come back here next time.
  useEffect(() => {
    rememberChannel(groupId, channelId);
    setViewingChannel({ groupId, channelId });
    // Back in front — the tab shown again, or its window focused again — reads
    // whatever landed while it was not (see useGroups' noteIncomingMessage).
    const onVisible = () => {
      if (isPageInFront()) setViewingChannel({ groupId, channelId });
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      setViewingChannel(null);
    };
  }, [groupId, channelId]);

  // ── Scroll ───────────────────────────────────────────────────────────

  // Pinning to the bottom once is not enough on the first paint of a room:
  // the log keeps growing for a frame or two after it (web fonts settling,
  // emoji and embeds measured, the composer taking its final height), and the
  // scroll left behind lands a little above the newest line. So the position
  // is written again on the next two frames, for as long as nobody has
  // scrolled away in the meantime.
  const pinFrames = useRef<number[]>([]);

  const cancelPin = useCallback(() => {
    for (const id of pinFrames.current) cancelAnimationFrame(id);
    pinFrames.current = [];
  }, []);

  const pinToBottom = useCallback(
    (el: HTMLDivElement) => {
      cancelPin();
      el.scrollTop = el.scrollHeight;
      if (typeof requestAnimationFrame === "undefined") return;
      const again = (left: number) => {
        pinFrames.current.push(
          requestAnimationFrame(() => {
            if (!atBottomRef.current || scrollRef.current !== el) return;
            el.scrollTop = el.scrollHeight;
            if (left > 0) again(left - 1);
          })
        );
      };
      again(1);
    },
    [cancelPin]
  );

  useEffect(() => cancelPin, [cancelPin]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const want = pendingScroll.current;
    if (!el || !want) return;
    pendingScroll.current = null;
    if (want.type === "bottom") pinToBottom(el);
    else if (want.type === "preserve") el.scrollTop = el.scrollHeight - want.height + want.top;
    else revealMessage(want.id);
  }, [messages, outbox]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    atBottomRef.current = atBottom;
    if (atBottom && unseen) setUnseen(0);
    if (el.scrollTop < NEAR_TOP_PX) void loadOlder();
  }

  // A reply's quote is a way to what it answers: scrolled into the middle of
  // the view and lit for a moment. An original older than what is loaded is
  // read in first, a page at a time, the way scrolling up would.
  const [jumping, setJumping] = useState(false);
  const [jumpMissed, setJumpMissed] = useState(false);

  function revealMessage(messageId: string): boolean {
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(messageId)}"]`);
    if (!el) return false;
    atBottomRef.current = false;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    // Lit through the Web Animations API rather than a class held in state:
    // it fades by itself, and a second jump to the same line restarts it.
    el.animate(
      [{ backgroundColor: "rgba(250, 204, 21, 0.35)" }, { backgroundColor: "rgba(250, 204, 21, 0)" }],
      { duration: 1800, easing: "ease-out" }
    );
    return true;
  }

  async function jumpToMessage(messageId: string) {
    setJumpMissed(false);
    if (revealMessage(messageId) || jumping || !messages || messages.length === 0) return;
    if (!hasMore) {
      setJumpMissed(true);
      return;
    }
    setJumping(true);
    let oldest = messages[0].ts;
    let older: GroupMessage[] = [];
    let olderAuthors: Record<string, GroupUser> = {};
    let more = true;
    let found = false;
    for (let page = 0; page < JUMP_MAX_PAGES && more && !found; page += 1) {
      const result = await fetchMessages(groupId, channelId, oldest).catch(() => null);
      // A failed read leaves "there is more" as it was; an empty page ends it.
      if (!result || !result.ok) break;
      if (result.messages.length === 0) {
        more = false;
        break;
      }
      older = [...result.messages, ...older];
      olderAuthors = { ...olderAuthors, ...result.authors };
      more = result.messages.length >= 50;
      oldest = result.messages[0].ts;
      found = result.messages.some((m) => m.id === messageId);
    }
    setJumping(false);
    if (older.length > 0) {
      const el = scrollRef.current;
      pendingScroll.current = found
        ? { type: "message", id: messageId }
        : el
          ? { type: "preserve", height: el.scrollHeight, top: el.scrollTop }
          : null;
      setHasMore(more);
      setAuthors((prev) => ({ ...olderAuthors, ...prev }));
      setMessages((prev) => {
        const known = new Set((prev ?? []).map((m) => m.id));
        return [...older.filter((m) => !known.has(m.id)), ...(prev ?? [])];
      });
    }
    if (!found) setJumpMissed(true);
  }

  function scrollToBottom() {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setUnseen(0);
  }

  // The conversation's box shrinks when the composer under it grows with a
  // long message (and grows back when it is sent). Somebody reading the
  // newest line keeps reading it, instead of it slipping under the composer.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (atBottomRef.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    // The log itself too, not only its box: a message that grows after it was
    // drawn (a picture given its size, an embed, a line rewrapped by the font
    // that finished loading) moves the bottom without the box ever changing.
    const content = el.firstElementChild;
    if (content) observer.observe(content);
    return () => observer.disconnect();
  });

  /** Pictures landing after the scroll moved would otherwise leave the newest line under the fold. */
  function onMediaLoad() {
    const el = scrollRef.current;
    if (el && atBottomRef.current) pinToBottom(el);
  }

  // ── People ───────────────────────────────────────────────────────────

  // What this person may do here (see lib/groupPermissions) — the composer
  // leaves out what the server would refuse anyway.
  const can = (key: TextPermissionKey) => (channel ? canInChannel(detail, channel, key) : false);

  // Everybody this room can put a name to: whoever is online, every author
  // and mentioned person the messages carried (see the API's
  // mentionedPeople), and anybody a search found.
  const personById = useMemo(() => {
    const out = new Map<string, GroupUser>();
    for (const person of Object.values(found)) out.set(person.id, person);
    for (const person of Object.values(authors)) out.set(person.id, person);
    for (const member of onlineEntry?.list ?? []) out.set(member.id, member);
    return out;
  }, [found, authors, onlineEntry]);
  const typingNames = useMemo(
    () => Object.entries(typers).map(([id, name]) => personById.get(id)?.name ?? name),
    [typers, personById]
  );
  // The people "@" offers before anything is typed: whoever is online and can
  // see this room, then whoever has written here, most recent first. Anybody
  // else is a search away (see searchPeople). This person among them: a
  // mention of yourself lights up like any other, it just alerts nobody.
  const memberCandidates: MentionCandidate[] = useMemo(() => {
    const out: MentionCandidate[] = [];
    const seen = new Set<string>();
    // Looked up here by id rather than captured, so this depends on values only.
    const room = detail.channels.find((c) => c.id === channelId) ?? null;
    for (const member of onlineEntry?.list ?? []) {
      if (seen.has(member.id)) continue;
      if (room && !memberCanInChannel(detail, room, { id: member.id, roleIds: member.roleIds }, "viewChannel")) {
        continue;
      }
      seen.add(member.id);
      out.push({ id: member.id, name: member.name, avatarUrl: member.avatarUrl });
    }
    const held = messages ?? [];
    for (let i = held.length - 1; i >= 0; i -= 1) {
      const writer = authors[held[i].from];
      if (!writer || seen.has(writer.id)) continue;
      seen.add(writer.id);
      out.push({ id: writer.id, name: writer.name, avatarUrl: writer.avatarUrl });
    }
    return out;
  }, [onlineEntry, messages, authors, channelId, detail]);

  const searchPeople = useCallback(
    async (query: string): Promise<MentionCandidate[]> => {
      // Scoped to this room: the API drops a mention of anybody who cannot
      // see it, so offering them would promise an alert that never comes.
      const result = await searchMembers(groupId, query, channelId).catch(() => null);
      if (!result || !result.ok) return [];
      const people = result.members;
      setFound((prev) => {
        const next: Record<string, GroupUser> = { ...prev };
        for (const person of people) next[person.id] = person;
        // Bounded: a long session of searching would otherwise keep
        // everybody it ever turned up.
        const ids = Object.keys(next);
        for (let i = 0; i < ids.length - MAX_FOUND; i += 1) delete next[ids[i]];
        return next;
      });
      return people.map((m) => ({ id: m.id, name: m.name, avatarUrl: m.avatarUrl }));
    },
    [groupId, channelId]
  );

  // What "#" offers: every room this person can see — which is exactly what
  // the group detail lists, since a hidden room is never sent to them.
  const roomById = useMemo(() => new Map(detail.channels.map((c) => [c.id, c])), [detail.channels]);
  const roomCandidates: MentionCandidate[] = useMemo(
    () => detail.channels.map((c) => ({ id: c.id, name: c.name, avatarUrl: null, room: c.kind })),
    [detail.channels]
  );
  // The group's roles, highest first — for @cargo, both ways.
  const roles = useMemo(() => rolesInOrder(detail), [detail]);
  const roleById = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles]);
  // A role anybody may mention, or any role for whoever may mention @everyone
  // (see the API's message route).
  const roleCandidates: MentionCandidate[] = roles
    .filter((r) => r.mentionable || can("mentionEveryone"))
    .map((r) => ({ id: `${ROLE_MENTION_PREFIX}${r.id}`, name: r.name, avatarUrl: null, color: r.color }));
  // Every role, for reading "{@Admin&@online}" — in the box as it is typed and
  // in the messages that carry one — and for the mention editor to offer. All
  // of them: an expression may narrow a mention this person is allowed by any
  // role at all (see lib/mentionExpr's mayMention).
  const composerRoles: ComposerRole[] = useMemo(
    () => roles.map((r) => ({ id: r.id, name: r.name, color: r.color })),
    [roles]
  );
  const builderRoles: BuilderRole[] = useMemo(
    () => roles.map((r) => ({ id: r.id, name: r.name, color: r.color, mentionable: r.mentionable })),
    [roles]
  );
  const resolveTyped = useMemo(() => typedAtomResolver(roles), [roles]);
  const roleNameOf = (id: string) => roleById.get(id)?.name ?? "?";
  // The editor can only build something sendable from an atom this person may
  // mention on its own: @everyone's permission, or a mentionable role.
  const builderUseful = can("mentionEveryone") || roles.some((r) => r.mentionable);
  // Whom this person may @: the site's own mentions (@everyone, @online and
  // @offline, all on @everyone's permission — see the API's mayMention), the
  // editor, the roles and the members — any of them, or none.
  const candidates: MentionCandidate[] = [
    ...(can("mentionEveryone") ? [EVERYONE_CANDIDATE, ONLINE_CANDIDATE, OFFLINE_CANDIDATE] : []),
    ...(builderUseful ? [MENTION_BUILDER_CANDIDATE] : []),
    ...roleCandidates,
    ...(can("mentionMembers") ? memberCandidates : []),
  ];
  // The mention editor, while it is open: `insert` puts what it builds into
  // the box, where "@mention" was typed (see the composer's insertBuilt).
  const [mentionBuilder, setMentionBuilder] = useState<{ insert: (text: string) => void } | null>(null);
  const openMentionBuilder = useCallback((insert: (text: string) => void) => setMentionBuilder({ insert }), []);
  // The roles I hold — a message that mentions one of them mentions me.
  const myRoleIds = detail.me.roleIds ?? detail.memberRoles?.[selfId] ?? [];

  function userOf(message: GroupMessage): GroupUser {
    // A webhook's message is drawn as it was sent — the name and picture it
    // posted under (which can differ message to message), not the webhook as
    // it is now, and never a member.
    if (message.webhook) {
      return {
        id: message.from,
        name: message.fromName || "Webhook",
        username: null,
        avatarUrl: message.webhook.avatarUrl,
        nameColor: null,
        flags: [],
        guest: false,
        webhook: true,
      };
    }
    return (
      personById.get(message.from) ?? {
        id: message.from,
        name: message.fromName || t("common.someone"),
        username: null,
        avatarUrl: null,
        nameColor: null,
        flags: [],
        guest: message.from.startsWith("guest:"),
      }
    );
  }

  function renderText(message: GroupMessage, trailing?: ReactNode): ReactNode {
    // Lit up only when the message actually mentioned somebody: an @name
    // typed without the permission to mention alerts nobody (the server drops
    // it), so it reads as the plain text it is.
    const mentioned = message.mentions ?? [];
    const mentionedRoles = mentioned
      .filter((m) => m.startsWith(ROLE_MENTION_PREFIX))
      .map((m) => roleById.get(m.slice(ROLE_MENTION_PREFIX.length)))
      .filter((r): r is NonNullable<typeof r> => Boolean(r));
    // The people it named, resolved by id — the message knows exactly which
    // ones it meant, even when two members share a name.
    const mentionedPeople = mentioned
      .filter((m) => !m.startsWith("@"))
      .map((id) => personById.get(id))
      .filter((p): p is GroupUser => Boolean(p));
    // Built from exactly what this message mentioned, since nothing else can
    // light up. It used to be built from every member's name and then
    // filtered: at ten thousand members, one pattern with ten thousand
    // alternatives, run against every message on screen. Most messages
    // mention nobody and get no pattern at all.
    const regex =
      mentioned.length === 0
        ? null
        : mentionsRegexFor([
            ...mentionedPeople.map((p) => p.name),
            ...(mentioned.includes(EVERYONE_MENTION) ? ["everyone"] : []),
            ...(mentioned.includes(ONLINE_MENTION) ? ["online"] : []),
            ...(mentioned.includes(OFFLINE_MENTION) ? ["offline"] : []),
            ...mentionedRoles.map((r) => r.name),
          ]);
    // Anything that is not a person could have been written as an expression
    // ("{@Admin&@online}", even a lone "{@Admin}") — only then is it worth
    // looking for braces.
    const mayHoldExpressions = mentioned.some((m) => m.startsWith("@"));
    // A message is cut at its tokens first: <@id> and <#id> are drawn from
    // their ids. What lies between them — and the whole of any message sent
    // before the tokens existed — goes through the old "@Name" reading below.
    //
    // All of that happens to the plain text between the markdown (see
    // components/Markdown), which never cuts through a token.
    return (
      <Markdown
        text={message.text}
        trailing={trailing}
        renderText={(plain, at) =>
          splitTokens(plain).flatMap((segment, s) => {
            const key = `${message.id}-${at}-${s}`;
            if (segment.type === "user") return [userToken(segment.id, mentioned.includes(segment.id), key)];
            if (segment.type === "room") return [roomToken(segment.id, key)];
            return legacyText(segment.value, key);
          })
        }
      />
    );

    // Expressions first: each "{…}" whose entry the message carries is one
    // mention, drawn whole, with what it meant in words on hover. One the
    // message does not carry — its author could not send it, or a role in it
    // was renamed since — is the plain text around it.
    function legacyText(text: string, keyPrefix: string): ReactNode[] {
      const spans =
        mayHoldExpressions && text.includes("{")
          ? findMentionExprs(text, resolveTyped).filter((span) => mentioned.includes(span.entry))
          : [];
      if (spans.length === 0) return namesIn(text, keyPrefix);
      const out: ReactNode[] = [];
      let last = 0;
      spans.forEach((span, index) => {
        if (span.start > last) out.push(...namesIn(text.slice(last, span.start), `${keyPrefix}-t${index}`));
        out.push(
          <Tooltip key={`${keyPrefix}-x${index}`} content={describeMention(span.expr, roleNameOf, t)}>
            <span className="cursor-help rounded bg-blue-500/15 px-0.5 font-semibold text-blue-600 dark:text-blue-400">
              {text.slice(span.start, span.end)}
            </span>
          </Tooltip>
        );
        last = span.end;
      });
      if (last < text.length) out.push(...namesIn(text.slice(last), `${keyPrefix}-t${spans.length}`));
      return out;
    }

    function namesIn(text: string, keyPrefix: string): ReactNode[] {
      const tokens = tokenizeMentions(text, regex);
      return tokens.map((token, index) => {
        const key = `${keyPrefix}-${index}`;
        if (token.type !== "mention") {
          return <Fragment key={key}>{linkify(token.value, key)}</Fragment>;
        }
        const wanted = normalizeSearch(token.name);
        // A role the message mentioned: drawn in its colour.
        const role = mentionedRoles.find((r) => normalizeSearch(r.name) === wanted);
        if (role) {
          return (
            <span
              key={key}
              className="rounded px-0.5 font-semibold"
              style={
                role.color
                  ? { color: role.color, backgroundColor: `${role.color}26` }
                  : { color: "#5865f2", backgroundColor: "#5865f226" }
              }
            >
              {token.value}
            </span>
          );
        }
        // Everything the pattern can match was mentioned, so there is no longer
        // a "matched but not really mentioned" case to fall back to plain text.
        const person = mentionedPeople.find((p) => normalizeSearch(p.name) === wanted) ?? null;
        // A mention is a way to the person's profile, the same dialog their
        // name opens anywhere else in the group. @everyone is nobody's.
        return person ? (
          <button
            key={key}
            type="button"
            onClick={(e) => clickPerson(e, person)}
            onContextMenu={(e) => contextPerson(e, person)}
            onMouseEnter={() => !person.guest && prefetchUserProfile(person.id)}
            title={t("groups.people.profileHint")}
            className="cursor-pointer rounded font-semibold text-blue-600 hover:underline dark:text-blue-400"
          >
            {token.value}
          </button>
        ) : (
          <span key={key} className="font-semibold text-blue-600 dark:text-blue-400">
            {token.value}
          </span>
        );
      });
    }
  }

  /**
   * <@id>, drawn as the person's name. Lit up — and a way to their profile —
   * only when the message actually alerted them: an author without the
   * permission to mention still wrote a name, and it reads as the plain text
   * it is, exactly as an "@Name" of theirs always did.
   */
  function userToken(id: string, alerted: boolean, key: string): ReactNode {
    const person = personById.get(id);
    const label = `@${person?.name ?? UNKNOWN_USER}`;
    if (!alerted) return <Fragment key={key}>{label}</Fragment>;
    if (!person) {
      return (
        <span key={key} className="font-semibold text-blue-600 dark:text-blue-400">
          {label}
        </span>
      );
    }
    return (
      <button
        key={key}
        type="button"
        onClick={(e) => clickPerson(e, person)}
        onContextMenu={(e) => contextPerson(e, person)}
        onMouseEnter={() => !person.guest && prefetchUserProfile(person.id)}
        title={t("groups.people.profileHint")}
        className="cursor-pointer rounded font-semibold text-blue-600 hover:underline dark:text-blue-400"
      >
        {label}
      </button>
    );
  }

  /**
   * <#id>, drawn as the room's name and a way into it. A room this person
   * cannot see is not in their group detail at all, so it reads as unknown —
   * which is also what a deleted one looks like, and says nothing about a
   * private room beyond that something was mentioned. Opening a voice room is
   * joining it, the same as it is from the rooms list.
   */
  function roomToken(id: string, key: string): ReactNode {
    const room = roomById.get(id);
    if (!room) {
      return (
        <span key={key} className="rounded bg-zinc-100 px-1 font-semibold text-zinc-500 dark:bg-zinc-800">
          #{UNKNOWN_ROOM}
        </span>
      );
    }
    return (
      <button
        key={key}
        type="button"
        onClick={() => navigation.push(`/groups/${groupId}/${room.id}`)}
        title={room.kind === "voice" ? t("groups.textChannelView.joinTheVoiceRoom") : t("groups.textChannelView.openTheRoom")}
        className="inline-flex cursor-pointer items-baseline gap-0.5 rounded bg-blue-500/10 px-1 font-semibold text-blue-600 hover:underline dark:text-blue-400"
      >
        {room.kind === "voice" ? <MdVolumeUp className="h-3.5 w-3.5 self-center" /> : "#"}
        {room.name}
      </button>
    );
  }

  /**
   * The text of a bot's or webhook's embed. Its <@id> and <#id> are drawn
   * like a message's — Discord lights up a mention in an embed without it
   * alerting anybody — except in a title that is itself a link, where they
   * are only the names.
   */
  function embedText(text: string, key: string, inLink: boolean): ReactNode {
    return splitTokens(text).map((segment, s) => {
      const k = `${key}-${s}`;
      if (segment.type === "user") {
        return inLink ? `@${personById.get(segment.id)?.name ?? UNKNOWN_USER}` : userToken(segment.id, true, k);
      }
      if (segment.type === "room") {
        return inLink ? `#${roomById.get(segment.id)?.name ?? UNKNOWN_ROOM}` : roomToken(segment.id, k);
      }
      return inLink ? segment.value : <Fragment key={k}>{linkify(segment.value, k)}</Fragment>;
    });
  }

  // ── Actions ──────────────────────────────────────────────────────────

  // On screen at once, delivered behind it — see lib/groupOutbox. Sending
  // is always a request to see the bottom of the conversation.
  function send(payload: ComposerPayload) {
    queueGroupMessage({
      groupId,
      channelId,
      text: payload.text,
      ...(payload.url ? { url: payload.url } : {}),
      ...(payload.images ? { images: payload.images } : {}),
      ...(payload.attachments ? { attachments: payload.attachments, files: payload.files } : {}),
      mentions: payload.mentions,
      replyTo,
      // A guest's name is whatever they are going by right now.
      name: detail.me.guest ? signalingClient.getSnapshot().name : null,
    });
    setReplyTo(null);
    atBottomRef.current = true;
    pendingScroll.current = { type: "bottom" };
  }

  // "Digitando..." on everybody else's screen — when, is GroupMessageComposer's call.
  function announceTyping(typing: boolean) {
    sendGroupTyping(groupId, channelId, typing);
  }

  function startReply(message: GroupMessage) {
    const author = userOf(message);
    // One thing at a time in the box: an edit in progress is dropped.
    composerRef.current?.cancelEdit();
    setReplyTo({
      id: message.id,
      userId: message.from,
      name: author.name,
      // A snapshot, shown as stored with no lookups — so it keeps names, not
      // the ids the message itself carries.
      ...(message.text
        ? {
            text: plainTokens(
              message.text,
              (id) => personById.get(id)?.name,
              (id) => roomById.get(id)?.name
            ).slice(0, 200),
          }
        : message.attachments?.length
          ? { text: attachmentsPreview(message.attachments).slice(0, 200) }
          : {}),
      // An aura line is not a message anybody replies to (it has no actions),
      // and a quote has no way to draw one.
      ...(message.kind && message.kind !== "aura" ? { kind: message.kind } : {}),
      ...(message.images ? { images: message.images.slice(0, 3) } : {}),
    });
  }

  // ── Editing ──────────────────────────────────────────────────────────
  //
  // Your own messages only, as on Discord — not even "Gerenciar mensagens"
  // changes somebody else's words. A GIF has no text to change, and a room
  // where you may no longer write is one where you may no longer edit.

  function canEdit(message: GroupMessage): boolean {
    return message.from === selfId && message.kind !== "gif" && can("sendMessages");
  }

  /** Opens a message in the composer, its tokens read back as the names they stand for. */
  function startEdit(message: GroupMessage) {
    if (!canEdit(message)) return;
    setReplyTo(null);
    const people: Named[] = [];
    const text = splitTokens(message.text)
      .map((segment) => {
        if (segment.type === "text") return segment.value;
        // Somebody (or a room) this screen has no name for stays as the token
        // it is, so saving does not quietly turn it into plain text.
        if (segment.type === "user") {
          const person = personById.get(segment.id);
          if (!person) return `<@${segment.id}>`;
          people.push({ id: person.id, name: person.name });
          return `@${person.name}`;
        }
        const room = roomById.get(segment.id);
        return room ? `#${room.name}` : `<#${segment.id}>`;
      })
      .join("");
    composerRef.current?.startEdit({ id: message.id, text, people });
  }

  /** ↑ in an empty composer: the newest message of yours that can be edited. */
  function editLast() {
    const held = messages ?? [];
    for (let i = held.length - 1; i >= 0; i -= 1) {
      if (!canEdit(held[i])) continue;
      startEdit(held[i]);
      return;
    }
  }

  // Changed here at once and then replaced by what the server answers; put
  // back as it was, with the reason, when the server refuses — the same as a
  // reaction. Erased to nothing, a message is one to delete, and asks so.
  async function saveEdit(messageId: string, payload: ComposerPayload) {
    const original = messages?.find((m) => m.id === messageId);
    if (!original) return;
    if (!payload.text && !original.images?.length && !original.attachments?.length) {
      confirmDelete(original);
      return;
    }
    if (payload.text === original.text) return;
    const patch = (changes: Partial<GroupMessage>) =>
      setMessages((prev) => prev?.map((m) => (m.id === messageId ? { ...m, ...changes } : m)) ?? prev);
    patch({ text: payload.text, editedAt: Date.now() });
    const result = await editGroupMessage(groupId, channelId, messageId, payload.text, payload.mentions);
    if (result.ok) {
      const { text, mentions, editedAt } = result.message;
      patch({ text, mentions, editedAt });
      return;
    }
    patch({ text: original.text, mentions: original.mentions, editedAt: original.editedAt });
    void openPopup("generic", { data: { title: t("common.didnTWork"), message: result.error } });
  }

  async function deleteNow(message: GroupMessage) {
    const result = await deleteGroupMessage(groupId, channelId, message.id);
    if (result.ok) setMessages((prev) => prev?.filter((m) => m.id !== message.id) ?? prev);
    else void openPopup("generic", { data: { title: t("common.didnTWork"), message: result.error } });
  }

  // Shift held: gone at once, the way Discord does it for whoever is clearing
  // a run of messages. Otherwise it asks first.
  function confirmDelete(message: GroupMessage, skipConfirm = false) {
    if (skipConfirm) {
      void deleteNow(message);
      return;
    }
    void openPopup("confirm", {
      data: {
        title: t("groups.textChannelView.deleteMessage"),
        message: t("groups.textChannelView.thisCannotBeUndone"),
        cancelLabel: t("common.cancel"),
        confirmLabel: t("common.delete"),
        confirmStyle: t("common.danger"),
        onChoose: async (confirmed: boolean) => {
          if (!confirmed) return;
          await deleteNow(message);
        },
      },
    });
  }

  // A reaction, put on or taken back. Changed here at once and then replaced
  // by what the server answers, so the chip lights up on the click; put back
  // as it was, with the reason, when the server refuses.
  async function toggleReaction(message: GroupMessage, emoji: string) {
    setPickerFor(null);
    const before = message.reactions ?? [];
    const on = !before.some((r) => r.emoji === emoji && r.users.includes(selfId));
    const apply = (reactions: GroupReaction[]) =>
      setMessages((prev) => prev?.map((m) => (m.id === message.id ? { ...m, reactions } : m)) ?? prev);
    apply(toggledReactions(before, emoji, selfId, on));
    const result = await reactToGroupMessage(groupId, channelId, message.id, emoji, on);
    if (result.ok) {
      apply(result.reactions);
      return;
    }
    apply(before);
    void openPopup("generic", { data: { title: t("common.didnTWork"), message: result.error } });
  }

  function reactorName(userId: string): string {
    if (userId === selfId) return t("common.you");
    return personById.get(userId)?.name ?? t("common.someone");
  }

  /** The emoji picker for one message, opened from `where`. */
  function reactionPicker(message: GroupMessage, where: string, trigger: ReactNode) {
    const key = `${message.id}:${where}`;
    return (
      <Popover
        open={pickerFor === key}
        onClose={() => setPickerFor(null)}
        placement="bottom-end"
        tooltip={t("groups.textChannelView.addReaction")}
        content={<ReactionPicker place={emojiPlace} onSelect={(emoji) => void toggleReaction(message, emoji)} />}
      >
        <button
          type="button"
          onClick={() => setPickerFor((open) => (open === key ? null : key))}
          aria-label={t("groups.textChannelView.addReaction")}
          className={
            where === "actions"
              ? rowAction
              : `${reactionChip} ${reactionChipIdle} cursor-pointer hover:border-zinc-400 dark:hover:border-zinc-600`
          }
        >
          {trigger}
        </button>
      </Popover>
    );
  }

  // ── Right button ─────────────────────────────────────────────────────
  //
  /** One found or pinned message, as the finder panel's row. */
  function finderRow(message: GroupMessage, people: Record<string, GroupUser>): FinderRow {
    const author = people[message.from] ?? userOf(message);
    const plain = stripMarkdown(
      plainTokens(message.text ?? "", (id) => personById.get(id)?.name, (id) => roomById.get(id)?.name)
    ).trim();
    return {
      id: message.id,
      ts: message.ts,
      name: author?.name ?? message.fromName ?? "",
      avatarUrl: author?.avatarUrl ?? null,
      userId: author && !author.guest && !author.webhook ? author.id : null,
      isGuest: author?.guest,
      bot: author?.bot,
      webhook: author?.webhook,
      nameColor: author?.nameColor ?? null,
      // A message can be a picture, a GIF or a file and no words at all — a
      // row with an empty line under the name would say nothing about which.
      snippet:
        plain ||
        (message.kind === "gif"
          ? "[GIF]"
          : message.images?.length
            ? `[${t("common.image")}]`
            : message.attachments?.[0]?.name ?? ""),
    };
  }

  /** Takes the pin off by id — from the panel, where the message may not be loaded here. */
  async function unpinById(messageId: string, message?: GroupMessage) {
    const result = await setGroupMessagePinned(groupId, channelId, messageId, false);
    if (!result.ok) {
      void openPopup("generic", { data: { title: t("common.didnTWork"), message: result.error } });
    } else if (message) {
      setMessages(
        (prev) => prev?.map((m) => (m.id === messageId ? { ...m, pinnedAt: undefined, pinnedBy: undefined } : m)) ?? prev
      );
      trackFinderEvent(MESSAGE_FINDER_EVENTS.unpin, groupId);
    } else {
      trackFinderEvent(MESSAGE_FINDER_EVENTS.unpin, groupId);
    }
    setPinsSeq((n) => n + 1);
  }

  /**
   * Pins a message, or takes the pin off. Written straight into the room's
   * own copy as well as sent: the server tells everybody looking, this tab
   * included, but the tick in the menu should not wait for a round trip.
   */
  async function togglePin(message: GroupMessage) {
    const pinned = !message.pinnedAt;
    markFeatureUsed(MESSAGE_FINDER_FEATURE);
    const result = await setGroupMessagePinned(groupId, channelId, message.id, pinned);
    if (!result.ok) {
      void openPopup("generic", { data: { title: t("common.didnTWork"), message: result.error } });
      return;
    }
    setMessages(
      (prev) =>
        prev?.map((m) =>
          m.id === message.id
            ? { ...m, pinnedAt: result.message.pinnedAt, pinnedBy: result.message.pinnedBy }
            : m
        ) ?? prev
    );
    setPinsSeq((n) => n + 1);
    trackFinderEvent(pinned ? MESSAGE_FINDER_EVENTS.pin : MESSAGE_FINDER_EVENTS.unpin, groupId);
  }

  // A message's menu: the quick reactions on top, then what its hover actions
  // do and what they had no room for — copying it, mentioning its author.
  // A link inside keeps the browser's own menu (open in a new tab, copy the
  // address); a picture gets its own two entries instead.

  const openChannelSettings = useOpenChannelSettings();

  function messageMenu(e: React.MouseEvent, message: GroupMessage, outgoing?: OutgoingMessage) {
    const target = e.target as Element;
    if (target.closest("a[href]")) return;
    const image = target.closest("img");
    const imageSrc = image?.getAttribute("src") ?? null;
    const author = userOf(message);
    const readable = message.text
      ? plainTokens(message.text, (id) => personById.get(id)?.name, (id) => roomById.get(id)?.name)
      : "";
    const canDelete = !outgoing && (message.from === selfId || canManageMessages);
    const reacting = !outgoing && can("addReactions");
    openContextMenu(e, {
      entries: [
        reacting && {
          type: "custom",
          render: (close) => (
            <div className="flex justify-between gap-0.5 px-1 pb-1">
              {QUICK_REACTIONS.map((emoji) => {
                const mine = Boolean(message.reactions?.some((r) => r.emoji === emoji && r.users.includes(selfId)));
                return (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => {
                      close();
                      void toggleReaction(message, emoji);
                    }}
                    aria-label={t("groups.reactionPicker.reactWithEmoji", { emoji })}
                    aria-pressed={mine}
                    className={`flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg transition hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                      mine ? "bg-blue-50 ring-1 ring-blue-500 dark:bg-blue-500/15" : ""
                    }`}
                  >
                    <Twemoji emoji={emoji} size={20} />
                  </button>
                );
              })}
            </div>
          ),
        },
        reacting && {
          label: t("groups.textChannelView.addReaction"),
          icon: <MdOutlineAddReaction className="h-4 w-4" />,
          // Opened on the message's own hover button, which is there (only
          // invisible) whether or not the pointer is over it.
          onSelect: () => requestAnimationFrame(() => setPickerFor(`${message.id}:actions`)),
        },
        !outgoing &&
          (message.reactions?.length ?? 0) > 0 && {
            label: t("groups.reactionsDialog.viewReactions"),
            icon: <MdEmojiEmotions className="h-4 w-4" />,
            onSelect: () => setReactionsView({ messageId: message.id, emoji: null }),
          },
        !outgoing && {
          label: t("common.reply"),
          icon: <MdReply className="h-4 w-4" />,
          onSelect: () => startReply(message),
        },
        !outgoing &&
          canEdit(message) && {
            label: t("common.edit"),
            icon: <MdEdit className="h-4 w-4" />,
            onSelect: () => startEdit(message),
          },
        outgoing?.status === "failed" && {
          label: t("common.tryAgain2"),
          icon: <MdRefresh className="h-4 w-4" />,
          onSelect: () => retryGroupMessage(channelId, outgoing.nonce),
        },
        outgoing?.status === "failed" && {
          label: t("common.discard"),
          icon: <MdClose className="h-4 w-4" />,
          danger: true,
          onSelect: () => discardGroupMessage(channelId, outgoing.nonce),
        },
        { type: "divider" },
        readable && {
          label: t("groups.contextMenu.copyText"),
          icon: <MdContentCopy className="h-4 w-4" />,
          onSelect: () => void copyText(readable),
        },
        imageSrc && {
          label: t("groups.contextMenu.openImage"),
          icon: <MdOpenInNew className="h-4 w-4" />,
          onSelect: () => void window.open(imageSrc, "_blank", "noopener"),
        },
        imageSrc &&
          !imageSrc.startsWith("data:") && {
            label: t("groups.contextMenu.copyImageLink"),
            icon: <MdLink className="h-4 w-4" />,
            onSelect: () => void copyText(imageSrc),
          },
        {
          label: t("groups.contextMenu.mentionName", { name: author.name }),
          icon: <MdAlternateEmail className="h-4 w-4" />,
          onSelect: () => mentionInComposer(author),
        },
        finder.enabled &&
          !outgoing &&
          canManageMessages && {
            label: message.pinnedAt
              ? t("messageFinder.unpin")
              : t("messageFinder.pin"),
            icon: <MdPushPin className="h-4 w-4" />,
            onSelect: () => void togglePin(message),
          },
        finder.enabled &&
          !outgoing && {
            label: t("messageFinder.copyMessageLink"),
            icon: <MdLink className="h-4 w-4" />,
            onSelect: () => {
              markFeatureUsed(MESSAGE_FINDER_FEATURE);
              trackFinderEvent(MESSAGE_FINDER_EVENTS.linkCopy, groupId);
              void copyText(groupMessageLink(groupId, channelId, message.id));
            },
          },
        !outgoing && {
          label: t("groups.contextMenu.copyMessageId"),
          icon: <MdContentCopy className="h-4 w-4" />,
          onSelect: () => void copyText(message.id),
        },
        canDelete && { type: "divider" },
        canDelete && {
          label: t("common.delete"),
          icon: <MdDeleteOutline className="h-4 w-4" />,
          danger: true,
          onSelect: () => confirmDelete(message),
        },
      ],
    });
  }

  /** The room's title bar: the room itself. */
  function roomMenu(e: React.MouseEvent) {
    if (!channel) return;
    openContextMenu(e, {
      title: channel.name,
      entries: [
        {
          label: t("groups.groupRail.copyLink"),
          icon: <MdLink className="h-4 w-4" />,
          onSelect: () => void copyText(`${window.location.origin}/groups/${groupId}/${channel.id}`),
        },
        { label: t("groups.memberMenu.copyId"), icon: <MdContentCopy className="h-4 w-4" />, onSelect: () => void copyText(channel.id) },
        { type: "divider" },
        { label: t("groups.textChannelView.groupMembers"), icon: <MdPeopleOutline className="h-4 w-4" />, onSelect: openMembers },
        canManage(detail, "manageChannels") && {
          label: t("groups.groupSidebar.roomSettings"),
          icon: <MdSettings className="h-4 w-4" />,
          onSelect: () => openChannelSettings(groupId, channel.id),
        },
      ],
    });
  }

  function openMembers() {
    void openPopup("group_settings", {
      maxWidth: "min(46rem, calc(100vw - 2rem))",
      width: "min(46rem, calc(100vw - 2rem))",
      maxHeight: "90dvh",
      data: { groupId, tab: "members" },
    });
  }

  // ── Render ───────────────────────────────────────────────────────────

  const channelName = channel?.name ?? t("common.room");

  /** A reply's "@Name": in their role's colour, and the gestures of any name. */
  function replyAuthor(message: GroupMessage): ReactNode {
    const reply = message.replyTo!;
    const known = reply.userId ? personById.get(reply.userId) : undefined;
    const color = reply.userId
      ? roleColorOf(detail, { id: reply.userId }) ?? known?.nameColor ?? null
      : null;
    const label = `@${known?.name ?? reply.name}`;
    if (!reply.userId) {
      return <span className="shrink-0 font-medium text-zinc-700 dark:text-zinc-300">{label}</span>;
    }
    // Answering a webhook's message: its card, not a profile it does not have.
    const webhook = reply.userId.startsWith(WEBHOOK_AUTHOR_PREFIX);
    const person = {
      id: reply.userId,
      name: webhook ? reply.name : known?.name ?? reply.name,
      avatarUrl: known?.avatarUrl ?? null,
      guest: !webhook && (known?.guest ?? reply.userId.startsWith("guest:")),
      webhook,
    };
    return (
      <button
        type="button"
        onClick={(e) => {
          // Their profile (or a mention), not the jump the quote around it does.
          e.stopPropagation();
          clickPerson(e, person);
        }}
        onKeyDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => contextPerson(e, person)}
        onMouseEnter={() => !person.guest && !person.webhook && prefetchUserProfile(person.id)}
        title={person.webhook ? t("webhook.tagTitle") : t("groups.people.profileHint")}
        className="shrink-0 cursor-pointer font-medium text-zinc-700 hover:underline dark:text-zinc-300"
        style={color ? { color } : undefined}
      >
        {label}
      </button>
    );
  }

  function actionsFor(message: GroupMessage) {
    const canDelete = message.from === selfId || canManageMessages;
    return (
      <span className="flex shrink-0 items-center">
        {can("addReactions") && reactionPicker(message, "actions", <MdOutlineAddReaction className="h-3.5 w-3.5" />)}
        <button type="button" onClick={() => startReply(message)} aria-label={t("common.reply")} title={t("common.reply")} className={rowAction}>
          <MdReply className="h-3.5 w-3.5" />
        </button>
        {canEdit(message) && (
          <button type="button" onClick={() => startEdit(message)} aria-label={t("common.edit")} title={t("common.edit")} className={rowAction}>
            <MdEdit className="h-3.5 w-3.5" />
          </button>
        )}
        {canDelete && (
          <button
            type="button"
            onClick={(e) => confirmDelete(message, e.shiftKey)}
            aria-label={t("common.delete")}
            title={t("groups.textChannelView.deleteShiftHint")}
            className={rowAction}
          >
            <MdDeleteOutline className="h-3.5 w-3.5" />
          </button>
        )}
      </span>
    );
  }

  // What every line of the log reads besides its own message: who people are,
  // the rooms and roles, the permissions (all on `detail`) and the language.
  // A line is redrawn when this changes, or when its own message does — not
  // when anything else in this room moves (see MessageRow).
  const rowContext = useMemo(
    () => ({ personById, roomById, roleById, resolveTyped, detail, channelId, t, navigation }),
    [personById, roomById, roleById, resolveTyped, detail, channelId, t, navigation]
  );
  // A reply's quote jumps through this, so a line that was not redrawn still
  // reaches the jump as it stands now — it reads the messages loaded so far.
  const jumpRef = useRef(jumpToMessage);
  useLayoutEffect(() => {
    jumpRef.current = jumpToMessage;
  });
  const jumpTo = useCallback((messageId: string) => void jumpRef.current(messageId), []);

  /**
   * A link to one message (`?m=<id>`, see lib/messageFinder) — followed once
   * the first page of the room is actually on screen, because the jump reads
   * what is loaded and pages backwards from there.
   *
   * The id is taken off the address as it is read, so it is spent: it says
   * "scroll here", not "this is where the page is", and a reload an hour
   * later should leave somebody where they were.
   */
  const followedLink = useRef<string | null>(null);
  useEffect(() => {
    if (!messages || messages.length === 0) return;
    if (followedLink.current === channelId) return;
    followedLink.current = channelId;
    const linked = takeLinkedMessageId();
    if (linked) jumpTo(linked);
  }, [messages, channelId, jumpTo]);

  /**
   * One line of the log — drawn through MessageRow, which calls this only when
   * the line (or something every line reads, see rowContext) has changed.
   */
  function drawRow(
    message: GroupMessage,
    outgoing: OutgoingMessage | undefined,
    grouped: boolean,
    gestures: MessageGestures
  ): ReactNode {
    const author = userOf(message);
    // The group's own line about an aura (see the API's postAuraMessage): one
    // sentence, written here rather than stored, so it reads in the reader's
    // language. Nothing to reply to, edit or delete — it is not somebody's
    // message, it is the group saying what happened.
    if (message.kind === "aura") {
      return (
        <li
          key={message.id}
          data-message-id={outgoing ? undefined : message.id}
          className="group -mx-1.5 mt-2.5 flex items-center gap-2 rounded-lg px-2 py-1 text-sm"
        >
          <MdAutoAwesome className="h-4 w-4 shrink-0 text-violet-500" />
          <span className="min-w-0 break-words text-zinc-600 dark:text-zinc-300">
            <button
              type="button"
              onClick={(e) => clickPerson(e, author)}
              onContextMenu={(e) => contextPerson(e, author)}
              className="cursor-pointer font-semibold text-zinc-800 hover:underline dark:text-zinc-100"
            >
              {author.name}
            </button>{" "}
            {t("groups.aura.chatLine")}
            {Boolean(message.auraLevel) && ` ${t("groups.aura.chatLineLevel", { level: message.auraLevel })}`}
          </span>
          <span className="shrink-0 text-xs tabular-nums text-zinc-400 dark:text-zinc-600">{timeLabel(message.ts)}</span>
          {/* Only "Gerenciar mensagens" takes an announcement down — not
              whoever gave the aura (the API says the same). */}
          {canManageMessages && !outgoing && (
            <button
              type="button"
              onClick={(e) => confirmDelete(message, e.shiftKey)}
              aria-label={t("common.delete")}
              title={t("groups.textChannelView.deleteShiftHint")}
              className={rowAction}
            >
              <MdDeleteOutline className="h-3.5 w-3.5" />
            </button>
          )}
        </li>
      );
    }
    // By id, @everyone, a role I hold, or an @online/@offline/expression
    // that took me in — see lib/mentionExpr's mentionsTakeIn. My own
    // messages too: mentioning myself, or everybody, lights it up here the
    // way it does for anybody else (the API alerts nobody about it).
    const mentionsMe =
      mentionsTakeIn(message.mentions, { id: selfId, roleIds: myRoleIds }, message.pingedMe) ||
      message.replyTo?.userId === selfId;
    return (
      <li
        key={message.id}
        data-message-id={outgoing ? undefined : message.id}
        {...gestures.handlers}
        style={gestures.style}
        className={`group relative -mx-1.5 rounded-lg px-2 text-sm transition-colors ${
          grouped ? "pb-0.5" : "mt-2.5 pb-0.5"
        } ${
          editingId === message.id && !outgoing
            ? "bg-amber-50 ring-1 ring-amber-300 dark:bg-amber-500/10 dark:ring-amber-500/40"
            : mentionsMe
              ? "bg-blue-100/70 py-1 dark:bg-blue-500/25"
              : "hover:bg-zinc-100/80 dark:hover:bg-zinc-900/70"
        } ${
          outgoing?.status === "sending" ? "opacity-60" : ""
        }`}
      >
        <SwipeReplyHint pull={gestures.pull} progress={gestures.progress} armed={gestures.armed} />
        {message.replyTo && (
          // The quote is a way to the message it answers; its author's name,
          // a way to them (the same three gestures as any name here).
          <div
            role="button"
            tabIndex={0}
            onClick={() => jumpTo(message.replyTo!.id)}
            onKeyDown={(e) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              jumpTo(message.replyTo!.id);
            }}
            title={t("groups.textChannelView.jumpToReply")}
            className="mb-1 flex max-w-full cursor-pointer items-center gap-1.5 rounded text-xs text-zinc-500 transition hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            <svg
              className="h-3.5 w-3.5 shrink-0 text-zinc-300 dark:text-zinc-600"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M 4 19 V 9 A 5 5 0 0 1 9 4 H 20" />
            </svg>
            {replyAuthor(message)}
            <span className="truncate text-zinc-400 dark:text-zinc-500">
              {stripMarkdown(message.replyTo.text ?? "") ||
                (message.replyTo.kind === "gif" ? <span className="italic">[GIF]</span> : <span className="italic">[Imagem]</span>)}
            </span>
          </div>
        )}
        {!grouped && (
          <div className="flex items-center justify-between gap-1.5">
            {/* The author, as a way to their profile — the same thing the
                room's chat does with a name. */}
            <button
              type="button"
              onClick={(e) => clickPerson(e, author)}
              onContextMenu={(e) => contextPerson(e, author)}
              onMouseEnter={() => !author.guest && !author.webhook && prefetchUserProfile(author.id)}
              title={author.webhook ? t("webhook.tagTitle") : t("groups.people.profileHint")}
              className="flex min-w-0 cursor-pointer items-center gap-1.5 text-left"
            >
              <UserAvatar
                src={author.avatarUrl}
                name={author.name}
                size={20}
                userId={author.guest || author.webhook ? null : author.id}
                isGuest={author.guest}
              />
              <span className="flex min-w-0 items-baseline gap-1.5">
                <DisplayUserName
                  name={author.name}
                  isGuest={author.guest}
                  verified={verifiedBadge(author.flags)}
                  bot={author.bot}
                  webhook={author.webhook}
                  color={roleColorOf(detail, { id: author.id }) ?? author.nameColor}
                  aura={author.webhook ? 0 : auraOf(author.id)}
                  className="min-w-0 font-medium text-zinc-700 hover:underline dark:text-zinc-300"
                />
                <span className="shrink-0 text-xs tabular-nums text-zinc-400 dark:text-zinc-600">{timeLabel(message.ts)}</span>
                {/* Pinned: said once, beside the time, so the list is not the
                    only place the state is visible. A run of messages from
                    one person shows it on the line that carries the name —
                    the others have no header to put it on. */}
                {message.pinnedAt && (
                  <MdPushPin
                    aria-label={t("messageFinder.pinnedMessage")}
                    title={t("messageFinder.pinnedMessage")}
                    className="h-3 w-3 shrink-0 self-center text-zinc-400 dark:text-zinc-600"
                  />
                )}
              </span>
            </button>
            {!outgoing && actionsFor(message)}
          </div>
        )}
        <div className={grouped ? "flex items-start justify-between gap-1.5" : ""}>
          <div className="min-w-0 flex-1">
            {message.text && (
              <div className="select-text break-words text-zinc-900 dark:text-zinc-100">
                {renderText(
                  message,
                  message.editedAt ? (
                    // Discord's "(editado)", at the end of the words, with when on hover.
                    <span
                      title={t("groups.textChannelView.editedAt", { when: editedLabel(message.editedAt) })}
                      className="ml-1 select-none whitespace-normal text-[11px] font-normal text-zinc-400 dark:text-zinc-500"
                    >
                      ({t("groups.textChannelView.edited")})
                    </span>
                  ) : undefined
                )}
              </div>
            )}
            {/* A group invite in the message, as a card to join from. */}
            {message.text && <InviteEmbeds text={message.text} />}
            <MessageEmbeds
              embeds={message.embeds}
              renderText={embedText}
              onOpenImage={(src) => setPreview({ src, alt: t("common.image") })}
              onLoad={onMediaLoad}
            />
            {message.kind === "gif" && message.url && (
              <button
                type="button"
                onClick={() => setPreview({ src: message.url!, alt: "GIF" })}
                className="mt-1 block cursor-zoom-in"
                aria-label={t("common.enlargeTheGif")}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={message.url}
                  alt="GIF"
                  onLoad={onMediaLoad}
                  className="block max-h-48 max-w-full rounded-lg object-contain"
                />
              </button>
            )}
            <ChatImages
              images={message.images ?? []}
              onOpen={(index) =>
                setPreview({ src: message.images![index], alt: t("common.image"), images: message.images, currentIndex: index })
              }
              onLoad={onMediaLoad}
              alt={t("common.image")}
              label={t("common.enlargeTheImage")}
              className="mt-1 max-w-sm"
              bordered
            />
            <MessageAttachments attachments={message.attachments} />
            {!outgoing && message.reactions && message.reactions.length > 0 && (
              // Discord's row: each emoji with how many, lit up when one of
              // them is yours. Clicking joins it or takes yours back — taking
              // it back is always allowed, joining needs "Reagir".
              <div className="mt-1 flex flex-wrap items-center gap-1">
                {message.reactions.map((reaction) => {
                  const mine = reaction.users.includes(selfId);
                  const allowed = mine || can("react");
                  return (
                    <button
                      key={reaction.emoji}
                      type="button"
                      disabled={!allowed}
                      aria-pressed={mine}
                      onClick={() => void toggleReaction(message, reaction.emoji)}
                      onContextMenu={(e) =>
                        openContextMenu(e, {
                          entries: [
                            {
                              label: t("groups.reactionsDialog.viewReactions"),
                              icon: <MdEmojiEmotions className="h-4 w-4" />,
                              onSelect: () => setReactionsView({ messageId: message.id, emoji: reaction.emoji }),
                            },
                            allowed && {
                              label: mine
                                ? t("groups.reactionsDialog.removeMine")
                                : t("groups.reactionsDialog.addMine"),
                              icon: <Twemoji emoji={reaction.emoji} size={16} />,
                              onSelect: () => void toggleReaction(message, reaction.emoji),
                            },
                          ],
                        })
                      }
                      title={describeReaction(reaction, reactorName)}
                      className={`${reactionChip} ${mine ? reactionChipMine : reactionChipIdle} ${
                        !allowed
                          ? "cursor-default"
                          : mine
                            ? "cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-500/25"
                            : "cursor-pointer hover:border-zinc-400 dark:hover:border-zinc-600"
                      }`}
                    >
                      <Twemoji emoji={reaction.emoji} size={16} />
                      <span className="tabular-nums">{reaction.users.length}</span>
                    </button>
                  );
                })}
                {can("addReactions") &&
                  message.reactions.length < 20 &&
                  reactionPicker(message, "row", <MdOutlineAddReaction className="h-3.5 w-3.5 opacity-70" />)}
              </div>
            )}
            {outgoing?.status === "failed" && (
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-red-500">
                <span>{t("common.notSent")}{outgoing.error ? ` — ${outgoing.error}` : "."}</span>
                <button
                  type="button"
                  onClick={() => retryGroupMessage(channelId, outgoing.nonce)}
                  className="cursor-pointer font-medium underline underline-offset-2"
                >
                  {t("common.tryAgain2")}
                </button>
                <button
                  type="button"
                  onClick={() => discardGroupMessage(channelId, outgoing.nonce)}
                  className="cursor-pointer text-zinc-500 underline underline-offset-2 dark:text-zinc-400"
                >
                  {t("common.discard")}
                </button>
              </p>
            )}
            {outgoing?.status === "sending" && outgoing.retrying && (
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{t("groups.textChannelView.itDidNotGoThroughFirst")}</p>
            )}
          </div>
          {grouped && !outgoing && actionsFor(message)}
        </div>
      </li>
    );
  }

  let body: ReactNode;
  if (!detail.chatAvailable) {
    body = (
      <p className="my-auto p-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
        {t("groups.textChannelView.textRoomsAreNotAvailableIn")}
      </p>
    );
  } else if (messages === null) {
    body = (
      <div className="flex flex-1 flex-col justify-end gap-3 px-3 py-4" aria-hidden>
        {["w-1/2", "w-2/3", "w-1/3"].map((width, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <span className="h-3 w-24 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
            <span className={`h-3 ${width} animate-pulse rounded bg-zinc-100 dark:bg-zinc-900`} />
          </div>
        ))}
      </div>
    );
  } else {
    let previous: GroupMessage | null = null;
    const rows: ReactNode[] = [];
    // The conversation, then whatever of mine is still on its way — in the
    // same run, so a line I just sent joins my previous ones under one header.
    const display: { message: GroupMessage; outgoing?: OutgoingMessage }[] = [
      ...messages.map((message) => ({ message })),
      ...outbox.map((outgoing) => ({ message: outgoingAsMessage(outgoing, selfId), outgoing })),
    ];
    for (const { message, outgoing } of display) {
      const newDay = !previous || dayKey(previous.ts) !== dayKey(message.ts);
      // `from` alone is enough to tell two people's messages apart, but not a
      // webhook's: every message it posts carries the same `from`
      // ("webhook:<id>") no matter who or what is actually speaking through
      // it — a Discord↔GoLive bridge, say, relaying several different
      // Discord members one after another. `fromName` and the picture it
      // posted with (`webhook.avatarUrl`, captured per message — see
      // GroupMessage.webhook) are what actually change per message, so both
      // have to match too before two of a webhook's lines are grouped as the
      // same speaker.
      const grouped =
        !newDay &&
        previous !== null &&
        previous.from === message.from &&
        previous.fromName === message.fromName &&
        (previous.webhook?.avatarUrl ?? null) === (message.webhook?.avatarUrl ?? null) &&
        message.ts - previous.ts < GROUP_GAP_MS &&
        !message.replyTo;
      if (newDay) {
        rows.push(
          <li key={`day-${message.id}`} className="my-3 text-center text-[11px] font-medium text-zinc-400 first:mt-0 dark:text-zinc-500">
            {dayLabel(message.ts)}
          </li>
        );
      }
      rows.push(
        <MessageRow
          key={message.id}
          draw={drawRow}
          message={message}
          outgoing={outgoing}
          grouped={grouped}
          editing={editingId === message.id}
          picker={pickerFor?.startsWith(`${message.id}:`) ? pickerFor : null}
          context={rowContext}
          // Nothing to answer in a line that is still on its way out, and
          // the group's own aura line is not somebody's message at all.
          onReply={outgoing || message.kind === "aura" ? undefined : () => startReply(message)}
          onMenu={message.kind === "aura" ? undefined : (e) => messageMenu(e, message, outgoing)}
        />
      );
      previous = message;
    }

    body = (
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        <ul className="flex min-h-full flex-col justify-end">
          {!hasMore && (
            <li className="mb-3 pt-6 text-center">
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("groups.textChannelView.theBeginningOf")} {channelName}</p>
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                {t("groups.textChannelView.whateverIsSaidHereIsSaved")}
              </p>
            </li>
          )}
          {loadingOlder && (
            <li className="py-2 text-center text-xs text-zinc-500 dark:text-zinc-400">{t("groups.textChannelView.loadingOldMessages")}</li>
          )}
          {loadError && <li className="py-2 text-center text-sm text-red-500">{loadError}</li>}
          {rows}
        </ul>
      </div>
    );
  }

  return (
    <div
      // How tall the composer may grow is measured against this (see GroupMessageComposer).
      data-chat-column
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white lg:rounded-xl lg:border lg:border-zinc-200 dark:bg-zinc-950 lg:dark:border-zinc-800">
      <div
        onContextMenu={roomMenu}
        // A phone has this in the group's own bar — the room's name, its
        // members and this menu (see GroupMobile).
        className="hidden shrink-0 items-center justify-between gap-2 border-b border-zinc-200 px-3 py-2 lg:flex dark:border-zinc-800"
      >
        <h2 className="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          <MdChatBubbleOutline className="h-4 w-4 shrink-0 text-zinc-500" />
          <span className="shrink-0 truncate">{channelName}</span>
          {channel?.topic && (
            // In the space left over beside the name, behind a divider — the
            // room's own line about what it is for. One line, truncated, with
            // the whole of it on hover: the header cannot grow, and a
            // description that pushed the name around would cost more than it
            // is worth. `min-w-0` on both is what makes the truncation land
            // here rather than on the name.
            <>
              <span aria-hidden className="h-4 w-px shrink-0 bg-zinc-300 dark:bg-zinc-700" />
              <span
                title={channel.topic}
                className="min-w-0 truncate text-xs font-normal text-zinc-500 dark:text-zinc-400"
              >
                {channel.topic}
              </span>
            </>
          )}
        </h2>
        {finder.enabled && (
          <>
            <Tooltip content={t("messageFinder.pinned")}>
              <button
                type="button"
                onClick={() => openFinder("pins")}
                aria-label={t("messageFinder.pinned")}
                className={headerButton(finderPanel === "pins")}
              >
                <MdPushPin className="h-4 w-4" />
                {/* On the first of the two only: two badges side by side
                    read as decoration rather than as news. */}
                <NewBadge id={MESSAGE_FINDER_FEATURE} />
              </button>
            </Tooltip>
            <Tooltip content={t("messageFinder.search")}>
              <button
                type="button"
                onClick={() => openFinder("search")}
                aria-label={t("messageFinder.search")}
                className={headerButton(finderPanel === "search")}
              >
                <MdSearch className="h-4 w-4" />
              </button>
            </Tooltip>
          </>
        )}
        <Tooltip content={t("groups.textChannelView.groupMembers")}>
          <button
            type="button"
            onClick={openMembers}
            aria-label={t("groups.textChannelView.groupMembers")}
            // From lg up the members are the column on the right (see GroupMembersPanel).
            className="flex shrink-0 cursor-pointer items-center gap-1 rounded-lg px-1.5 py-1 text-xs text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 lg:hidden dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <MdPeopleOutline className="h-4 w-4" />
            {detail.group.memberCount}
          </button>
        </Tooltip>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
        {body}
        {(jumping || jumpMissed) && (
          <button
            type="button"
            onClick={() => setJumpMissed(false)}
            className="absolute left-1/2 top-2 z-10 -translate-x-1/2 cursor-pointer rounded-full bg-zinc-950 px-3 py-1 text-xs font-medium text-white shadow-lg dark:bg-zinc-50 dark:text-zinc-950"
          >
            {jumping ? t("groups.textChannelView.lookingForTheMessage") : t("groups.textChannelView.originalNotFound")}
          </button>
        )}
        {finderPanel && (
          <MessageFinderPanel
            groupId={groupId}
            panel={finderPanel}
            onPanelChange={openFinder}
            onClose={() => setFinderPanel(null)}
            onJump={(row) => {
              // Closed on a phone, where the panel covers the room it is
              // about to scroll; left open on a wide screen, where somebody
              // is walking down a list of hits.
              if (window.innerWidth < 640) setFinderPanel(null);
              // A hit from another room is not something this view can
              // scroll to: the room is opened at that message instead,
              // through the same link a "copiar link" produces.
              if (row.scopeId && row.scopeId !== channelId) {
                navigation.push(`${groupPath(groupId, row.scopeId)}?${MESSAGE_LINK_PARAM}=${encodeURIComponent(row.id)}`);
                return;
              }
              jumpTo(row.id);
            }}
            refreshKey={pinsSeq}
            scope={{
              wideLabel: t("messageFinder.wholeGroup"),
              narrowLabel: t("messageFinder.thisRoom"),
              wide: searchWholeGroup,
              onChange: setSearchWholeGroup,
            }}
            loadPins={async (signal) => {
              const result = await fetchPinnedMessages(groupId, channelId, signal);
              return result.ok ? result.messages.map((m) => finderRow(m, result.authors)) : null;
            }}
            search={async (query, signal) => {
              const result = await searchGroupMessages(
                groupId,
                query,
                searchWholeGroup ? null : channelId,
                signal
              );
              if (!result.ok) return null;
              return result.messages.map((m) => ({
                ...finderRow(m, result.authors),
                // Named only when the answer could have come from anywhere:
                // inside one room the label would be the same on every row.
                context: searchWholeGroup ? result.channels[m.channelId] : undefined,
                scopeId: m.channelId,
              }));
            }}
            onUnpin={
              canManageMessages
                ? (row) => {
                    const message = messages?.find((m) => m.id === row.id);
                    // Not on this page any more: unpinned by id alone, and
                    // the list reads itself again from the server.
                    void unpinById(row.id, message);
                  }
                : undefined
            }
          />
        )}
        {unseen > 0 && (
          <button
            type="button"
            onClick={scrollToBottom}
            className="absolute bottom-2 left-1/2 -translate-x-1/2 cursor-pointer rounded-full bg-zinc-950 px-3 py-1 text-xs font-medium text-white shadow-lg transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            {unseen === 1 ? "1 mensagem nova" : `${unseen} mensagens novas`}
          </button>
        )}
      </div>

      {detail.chatAvailable && (
        // Always here, at a fixed height, whether or not anyone is typing —
        // a row that only appears when needed changes this box's height each
        // time, and the conversation itself visibly shifts up and down as a
        // result. Kept out of the message log's own box (rather than a
        // fade-in overlay over its last line) so a long name never sits on
        // top of what somebody just said. The gradient is decoration, not
        // cover-up: from transparent to the panel's own background, top to
        // bottom.
        <div className="h-6 shrink-0 overflow-hidden bg-gradient-to-b from-transparent to-white px-3 dark:to-zinc-950">
          {typingNames.length > 0 && (
            <p aria-live="polite" className="truncate text-xs leading-6 text-zinc-500 italic">
              {formatTypingLabel(typingNames)}
            </p>
          )}
        </div>
      )}

      {detail.chatAvailable && (
        <GroupMessageComposer
          ref={composerRef}
          emojiPlace={emojiPlace}
          channelName={channelName}
          candidates={candidates}
          rooms={roomCandidates}
          roles={composerRoles}
          onOpenMentionBuilder={builderUseful ? openMentionBuilder : undefined}
          searchPeople={can("mentionMembers") ? searchPeople : undefined}
          replyingTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          onSend={send}
          onSubmitEdit={(messageId, payload) => void saveEdit(messageId, payload)}
          onEditingChange={setEditingId}
          onEditLast={editLast}
          disabledReason={can("sendMessages") ? null : t("groups.textChannelView.youCannotSendMessagesInThis")}
          allow={{ gifs: can("sendGifs"), images: can("sendImages") }}
          onTypingChange={can("sendMessages") ? announceTyping : undefined}
          // Half-written messages survive leaving the room, for as long as the
          // tab is open — see lib/composerDrafts.
          draftKey={groupDraftKey(groupId, channelId)}
        />
      )}

      <ChatImageModal preview={preview} onClose={() => setPreview(null)} />

      {mentionBuilder && (
        <MentionBuilderDialog
          groupId={groupId}
          channelId={channelId}
          roles={builderRoles}
          canMentionEveryone={can("mentionEveryone")}
          onInsert={(text) => {
            mentionBuilder.insert(text);
            setMentionBuilder(null);
          }}
          onClose={() => setMentionBuilder(null)}
        />
      )}

      {reactionsView &&
        (() => {
          // Drawn from the message as the room holds it, so the counts move
          // live; a message deleted meanwhile takes the dialog with it.
          const viewed = messages?.find((m) => m.id === reactionsView.messageId);
          if (!viewed) return null;
          return (
            <ReactionsDialog
              detail={detail}
              channelId={channelId}
              messageId={viewed.id}
              reactions={viewed.reactions ?? []}
              initialEmoji={reactionsView.emoji}
              onClose={() => setReactionsView(null)}
            />
          );
        })()}
    </div>
  );
});

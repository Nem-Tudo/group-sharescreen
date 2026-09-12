"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import useNtPopups from "ntpopups";
import { MdChatBubbleOutline, MdDeleteOutline, MdOutlineAddReaction, MdPeopleOutline, MdReply } from "react-icons/md";
import { ChatImageModal, type ChatImagePreviewState } from "@/components/ChatImageModal";
import { DisplayUserName } from "@/components/DisplayUserName";
import { Popover, Tooltip } from "@/components/Tooltip";
import { UserAvatar } from "@/components/UserAvatar";
import {
  GroupMessageComposer,
  type ComposerPayload,
  type MentionCandidate,
} from "@/components/groups/GroupMessageComposer";
import { openGroupProfile } from "@/components/groups/groupProfile";
import { ReactionPicker } from "@/components/groups/ReactionPicker";
import { rememberChannel } from "@/components/groups/lastChannel";
import { buildMentionsRegex, normalizeSearch, tokenizeMentions } from "@/lib/chatMentions";
import {
  EVERYONE_MENTION,
  ROLE_MENTION_PREFIX,
  canInChannel,
  canManage,
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
  useGroupMembers,
} from "@/lib/groupCache";
import {
  deleteGroupMessage,
  fetchMessages,
  reactToGroupMessage,
  sendGroupTyping,
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

function timeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(ts: number): string {
  const now = Date.now();
  if (dayKey(ts) === dayKey(now)) return "Hoje";
  if (dayKey(ts) === dayKey(now - 86_400_000)) return "Ontem";
  return new Date(ts).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
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
        className="break-all underline underline-offset-2 hover:text-zinc-950 dark:hover:text-white"
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
    replyTo: outgoing.replyTo,
    mentions: outgoing.mentions,
    ts: outgoing.ts,
  };
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

/** @everyone in the mention suggestions — see lib/groupPermissions' EVERYONE_MENTION. */
const EVERYONE_CANDIDATE: MentionCandidate = { id: EVERYONE_MENTION, name: "everyone", avatarUrl: null };

export function TextChannelView({ detail, channelId }: { detail: GroupDetail; channelId: string }) {
  const { openPopup } = useNtPopups();
  const groupId = detail.group.id;
  const channel = detail.channels.find((c) => c.id === channelId) ?? null;
  const selfId = detail.me.id;
  // Deleting somebody else's message is "Gerenciar mensagens" (see lib/groupPermissions).
  const canManageMessages = canManage(detail, "manageMessages");

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

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const atBottomRef = useRef(true);
  const olderInFlight = useRef(false);
  const pendingScroll = useRef<{ type: "bottom" } | { type: "preserve"; height: number; top: number } | null>(
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
          if (prev === null) setLoadError("Não foi possível carregar as mensagens.");
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
  }, [groupId, channelId, detail.chatAvailable]);

  // Everything this room holds goes back into the cache as it changes, so the
  // next visit opens on exactly what was on screen when this one ended.
  useEffect(() => {
    if (!messages || !detail.chatAvailable || loadError) return;
    const held = getCachedChannel(channelId);
    putCachedChannel(channelId, { messages, authors, hasMore, fetchedAt: held?.fetchedAt ?? Date.now() });
  }, [channelId, messages, authors, hasMore, detail.chatAvailable, loadError]);

  // Members, shared with the members column — for @mention suggestions and for
  // naming authors the page did not carry.
  const heldMembers = useGroupMembers(groupId, membersRevalidateKey(detail));
  // One stable empty list while nothing is held, so what is derived from it
  // below is not recomputed on every render.
  const members = useMemo(() => heldMembers ?? [], [heldMembers]);

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
      onGroupMessage((message, author) => {
        if (message.groupId !== groupId || message.channelId !== channelId) return;
        if (author) setAuthors((prev) => ({ ...prev, [author.id]: author }));
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
        setMessages((prev) => prev?.filter((m) => m.id !== event.messageId) ?? prev);
      }),
    [channelId]
  );

  // This room is the one on screen — nothing in it is unread, here or on any
  // other device — and the group should come back here next time.
  useEffect(() => {
    rememberChannel(groupId, channelId);
    setViewingChannel({ groupId, channelId });
    const onVisible = () => {
      if (document.visibilityState === "visible") setViewingChannel({ groupId, channelId });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      setViewingChannel(null);
    };
  }, [groupId, channelId]);

  // ── Scroll ───────────────────────────────────────────────────────────

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const want = pendingScroll.current;
    if (!el || !want) return;
    pendingScroll.current = null;
    if (want.type === "bottom") el.scrollTop = el.scrollHeight;
    else el.scrollTop = el.scrollHeight - want.height + want.top;
  }, [messages, outbox]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    atBottomRef.current = atBottom;
    if (atBottom && unseen) setUnseen(0);
    if (el.scrollTop < NEAR_TOP_PX) void loadOlder();
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
    return () => observer.disconnect();
  });

  /** Pictures landing after the scroll moved would otherwise leave the newest line under the fold. */
  function onMediaLoad() {
    const el = scrollRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }

  // ── People ───────────────────────────────────────────────────────────

  // What this person may do here (see lib/groupPermissions) — the composer
  // leaves out what the server would refuse anyway.
  const can = (key: TextPermissionKey) => (channel ? canInChannel(detail, channel, key) : false);

  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const typingNames = useMemo(
    () => Object.entries(typers).map(([id, name]) => memberById.get(id)?.name ?? name),
    [typers, memberById]
  );
  const memberCandidates: MentionCandidate[] = useMemo(
    () => members.filter((m) => m.id !== selfId).map((m) => ({ id: m.id, name: m.name, avatarUrl: m.avatarUrl })),
    [members, selfId]
  );
  // The group's roles, highest first — for @cargo, both ways.
  const roles = useMemo(() => rolesInOrder(detail), [detail]);
  const roleById = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles]);
  // A role anybody may mention, or any role for whoever may mention @everyone
  // (see the API's message route).
  const roleCandidates: MentionCandidate[] = roles
    .filter((r) => r.mentionable || can("mentionEveryone"))
    .map((r) => ({ id: `${ROLE_MENTION_PREFIX}${r.id}`, name: r.name, avatarUrl: null, color: r.color }));
  // Whom this person may @: the members, @everyone, roles — any of them, or none.
  const candidates: MentionCandidate[] = [
    ...(can("mentionEveryone") ? [EVERYONE_CANDIDATE] : []),
    ...roleCandidates,
    ...(can("mentionMembers") ? memberCandidates : []),
  ];
  const names = useMemo(() => members.map((m) => m.name), [members]);
  const mentionRegex = useMemo(() => buildMentionsRegex(names), [names]);
  const everyoneRegex = useMemo(() => buildMentionsRegex([...names, "everyone"]), [names]);
  // For a message that mentions a role: every name there is — and which of
  // them actually light up is the message's own mentions' to say.
  const fullRegex = useMemo(
    () => buildMentionsRegex([...names, "everyone", ...roles.map((r) => r.name)]),
    [names, roles]
  );
  // The roles I hold — a message that mentions one of them mentions me.
  const myRoleIds = detail.me.roleIds ?? detail.memberRoles?.[selfId] ?? [];

  function userOf(message: GroupMessage): GroupUser {
    return (
      memberById.get(message.from) ??
      authors[message.from] ?? {
        id: message.from,
        name: message.fromName || "Alguém",
        username: null,
        avatarUrl: null,
        nameColor: null,
        flags: [],
        guest: message.from.startsWith("guest:"),
      }
    );
  }

  /**
   * The member an @mention in a message names — looked up by name among the
   * people the message actually mentioned first (two members may share a
   * name, and the message knows which one it meant), then among everybody.
   * Null for @everyone and for a name nobody in the group has any more.
   */
  function mentionedMember(message: GroupMessage, name: string): GroupUser | null {
    const wanted = normalizeSearch(name);
    if (wanted === "everyone") return null;
    const named = (message.mentions ?? [])
      .map((id) => memberById.get(id))
      .find((m) => m && normalizeSearch(m.name) === wanted);
    return named ?? members.find((m) => normalizeSearch(m.name) === wanted) ?? null;
  }

  function renderText(message: GroupMessage): ReactNode {
    // Lit up only when the message actually mentioned somebody: an @name
    // typed without the permission to mention alerts nobody (the server drops
    // it), so it reads as the plain text it is.
    const mentioned = message.mentions ?? [];
    const mentionedRoles = mentioned
      .filter((m) => m.startsWith(ROLE_MENTION_PREFIX))
      .map((m) => roleById.get(m.slice(ROLE_MENTION_PREFIX.length)))
      .filter((r): r is NonNullable<typeof r> => Boolean(r));
    const regex =
      mentioned.length === 0
        ? null
        : mentionedRoles.length > 0
          ? fullRegex
          : mentioned.includes(EVERYONE_MENTION)
            ? everyoneRegex
            : mentionRegex;
    const tokens = tokenizeMentions(message.text, regex);
    return tokens.map((token, index) => {
      if (token.type !== "mention") {
        return <Fragment key={index}>{linkify(token.value, `${message.id}-${index}`)}</Fragment>;
      }
      const wanted = normalizeSearch(token.name);
      // A role the message mentioned: drawn in its colour.
      const role = mentionedRoles.find((r) => normalizeSearch(r.name) === wanted);
      if (role) {
        return (
          <span
            key={index}
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
      // In the full list, a name the message did not mention is plain text —
      // @everyone without its permission, a role it did not mention.
      if (regex === fullRegex) {
        const isEveryone = wanted === "everyone";
        const isMember = members.some((m) => normalizeSearch(m.name) === wanted);
        if ((isEveryone && !mentioned.includes(EVERYONE_MENTION)) || (!isEveryone && !isMember)) {
          return <Fragment key={index}>{linkify(token.value, `${message.id}-${index}`)}</Fragment>;
        }
      }
      const person = mentionedMember(message, token.name);
      // A mention is a way to the person's profile, the same dialog their
      // name opens anywhere else in the group. @everyone is nobody's.
      return person ? (
        <button
          key={index}
          type="button"
          onClick={() =>
            openGroupProfile({ id: person.id, name: person.name, avatarUrl: person.avatarUrl, guest: person.guest })
          }
          onMouseEnter={() => !person.guest && prefetchUserProfile(person.id)}
          title="Ver perfil"
          className="cursor-pointer rounded font-semibold text-blue-600 hover:underline dark:text-blue-400"
        >
          {token.value}
        </button>
      ) : (
        <span key={index} className="font-semibold text-blue-600 dark:text-blue-400">
          {token.value}
        </span>
      );
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
    setReplyTo({
      id: message.id,
      userId: message.from,
      name: author.name,
      ...(message.text ? { text: message.text.slice(0, 200) } : {}),
      ...(message.kind ? { kind: message.kind } : {}),
      ...(message.images ? { images: message.images.slice(0, 3) } : {}),
    });
  }

  function confirmDelete(message: GroupMessage) {
    void openPopup("confirm", {
      data: {
        title: "Apagar mensagem?",
        message: "Isso não pode ser desfeito.",
        cancelLabel: "Cancelar",
        confirmLabel: "Apagar",
        confirmStyle: "Danger",
        onChoose: async (confirmed: boolean) => {
          if (!confirmed) return;
          const result = await deleteGroupMessage(groupId, channelId, message.id);
          if (result.ok) setMessages((prev) => prev?.filter((m) => m.id !== message.id) ?? prev);
          else void openPopup("generic", { data: { title: "Não deu", message: result.error } });
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
    void openPopup("generic", { data: { title: "Não deu", message: result.error } });
  }

  function reactorName(userId: string): string {
    if (userId === selfId) return "Você";
    return memberById.get(userId)?.name ?? authors[userId]?.name ?? "Alguém";
  }

  /** The emoji picker for one message, opened from `where`. */
  function reactionPicker(message: GroupMessage, where: string, trigger: ReactNode) {
    const key = `${message.id}:${where}`;
    return (
      <Popover
        open={pickerFor === key}
        onClose={() => setPickerFor(null)}
        placement="bottom-end"
        tooltip="Adicionar reação"
        content={<ReactionPicker onSelect={(emoji) => void toggleReaction(message, emoji)} />}
      >
        <button
          type="button"
          onClick={() => setPickerFor((open) => (open === key ? null : key))}
          aria-label="Adicionar reação"
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

  function openMembers() {
    void openPopup("group_settings", {
      maxWidth: "min(46rem, calc(100vw - 2rem))",
      width: "min(46rem, calc(100vw - 2rem))",
      maxHeight: "90dvh",
      data: { groupId, tab: "members" },
    });
  }

  // ── Render ───────────────────────────────────────────────────────────

  const channelName = channel?.name ?? "sala";

  function actionsFor(message: GroupMessage) {
    const canDelete = message.from === selfId || canManageMessages;
    return (
      <span className="flex shrink-0 items-center">
        {can("addReactions") && reactionPicker(message, "actions", <MdOutlineAddReaction className="h-3.5 w-3.5" />)}
        <button type="button" onClick={() => startReply(message)} aria-label="Responder" title="Responder" className={rowAction}>
          <MdReply className="h-3.5 w-3.5" />
        </button>
        {canDelete && (
          <button type="button" onClick={() => confirmDelete(message)} aria-label="Apagar" title="Apagar" className={rowAction}>
            <MdDeleteOutline className="h-3.5 w-3.5" />
          </button>
        )}
      </span>
    );
  }

  let body: ReactNode;
  if (!detail.chatAvailable) {
    body = (
      <p className="my-auto p-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
        As salas de texto não estão disponíveis nesta instalação.
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
      const grouped =
        !newDay &&
        previous !== null &&
        previous.from === message.from &&
        message.ts - previous.ts < GROUP_GAP_MS &&
        !message.replyTo;
      if (newDay) {
        rows.push(
          <li key={`day-${message.id}`} className="my-3 text-center text-[11px] font-medium text-zinc-400 first:mt-0 dark:text-zinc-500">
            {dayLabel(message.ts)}
          </li>
        );
      }
      const author = userOf(message);
      const mentionsMe =
        Boolean(message.mentions?.includes(selfId)) ||
        (Boolean(message.mentions?.includes(EVERYONE_MENTION)) && message.from !== selfId) ||
        (message.from !== selfId &&
          Boolean(
            message.mentions?.some(
              (m) => m.startsWith(ROLE_MENTION_PREFIX) && myRoleIds.includes(m.slice(ROLE_MENTION_PREFIX.length))
            )
          )) ||
        message.replyTo?.userId === selfId;
      rows.push(
        <li
          key={message.id}
          className={`group relative -mx-1.5 rounded-lg px-2 text-sm transition-colors ${
            grouped ? "pb-0.5" : "mt-2.5 pb-0.5"
          } ${mentionsMe ? "bg-blue-100/70 py-1 dark:bg-blue-500/25" : "hover:bg-zinc-100/80 dark:hover:bg-zinc-900/70"} ${
            outgoing?.status === "sending" ? "opacity-60" : ""
          }`}
        >
          {message.replyTo && (
            <div className="mb-1 flex max-w-full items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
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
              <span className="font-medium text-zinc-700 dark:text-zinc-300">@{message.replyTo.name}</span>
              <span className="truncate text-zinc-400 dark:text-zinc-500">
                {message.replyTo.text ||
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
                onClick={() =>
                  openGroupProfile({
                    id: author.id,
                    name: author.name,
                    avatarUrl: author.avatarUrl,
                    guest: author.guest,
                  })
                }
                onMouseEnter={() => !author.guest && prefetchUserProfile(author.id)}
                title="Ver perfil"
                className="flex min-w-0 cursor-pointer items-center gap-1.5 text-left"
              >
                <UserAvatar
                  src={author.avatarUrl}
                  name={author.name}
                  size={20}
                  userId={author.guest ? null : author.id}
                  isGuest={author.guest}
                />
                <span className="flex min-w-0 items-baseline gap-1.5">
                  <DisplayUserName
                    name={author.name}
                    isGuest={author.guest}
                    verified={verifiedBadge(author.flags)}
                    color={roleColorOf(detail, { id: author.id }) ?? author.nameColor}
                    className="min-w-0 font-medium text-zinc-700 hover:underline dark:text-zinc-300"
                  />
                  <span className="shrink-0 text-xs tabular-nums text-zinc-400 dark:text-zinc-600">{timeLabel(message.ts)}</span>
                </span>
              </button>
              {!outgoing && actionsFor(message)}
            </div>
          )}
          <div className={grouped ? "flex items-start justify-between gap-1.5" : ""}>
            <div className="min-w-0 flex-1">
              {message.text && (
                <p className="whitespace-pre-wrap break-words text-zinc-900 dark:text-zinc-100">{renderText(message)}</p>
              )}
              {message.kind === "gif" && message.url && (
                <button
                  type="button"
                  onClick={() => setPreview({ src: message.url!, alt: "GIF" })}
                  className="mt-1 block cursor-zoom-in"
                  aria-label="Ampliar o GIF"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={message.url} alt="GIF" onLoad={onMediaLoad} className="max-h-48 rounded-lg" />
                </button>
              )}
              {message.images && message.images.length > 0 && (
                <div className={`mt-1 grid max-w-xs gap-1 ${message.images.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
                  {message.images.map((url, index) => (
                    <button
                      key={index}
                      type="button"
                      onClick={() => setPreview({ src: url, alt: "Imagem", images: message.images, currentIndex: index })}
                      className="block cursor-zoom-in overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800"
                      aria-label="Ampliar a imagem"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={url}
                        alt="Imagem"
                        onLoad={onMediaLoad}
                        className={`w-full object-cover ${message.images!.length > 1 ? "aspect-square" : "max-h-64 object-contain"}`}
                      />
                    </button>
                  ))}
                </div>
              )}
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
                        title={describeReaction(reaction, reactorName)}
                        className={`${reactionChip} ${mine ? reactionChipMine : reactionChipIdle} ${
                          !allowed
                            ? "cursor-default"
                            : mine
                              ? "cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-500/25"
                              : "cursor-pointer hover:border-zinc-400 dark:hover:border-zinc-600"
                        }`}
                      >
                        <span className="text-sm leading-none">{reaction.emoji}</span>
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
                  <span>Não enviada{outgoing.error ? ` — ${outgoing.error}` : "."}</span>
                  <button
                    type="button"
                    onClick={() => retryGroupMessage(channelId, outgoing.nonce)}
                    className="cursor-pointer font-medium underline underline-offset-2"
                  >
                    Tentar de novo
                  </button>
                  <button
                    type="button"
                    onClick={() => discardGroupMessage(channelId, outgoing.nonce)}
                    className="cursor-pointer text-zinc-500 underline underline-offset-2 dark:text-zinc-400"
                  >
                    Descartar
                  </button>
                </p>
              )}
              {outgoing?.status === "sending" && outgoing.retrying && (
                <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">Não foi de primeira — tentando enviar de novo…</p>
              )}
            </div>
            {grouped && !outgoing && actionsFor(message)}
          </div>
        </li>
      );
      previous = message;
    }

    body = (
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        <ul className="flex min-h-full flex-col justify-end">
          {!hasMore && (
            <li className="mb-3 pt-6 text-center">
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Começo de {channelName}</p>
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                O que for dito aqui fica salvo para todo mundo do grupo.
              </p>
            </li>
          )}
          {loadingOlder && (
            <li className="py-2 text-center text-xs text-zinc-500 dark:text-zinc-400">Carregando mensagens antigas…</li>
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
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <h2 className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          <MdChatBubbleOutline className="h-4 w-4 shrink-0 text-zinc-500" />
          <span className="truncate">{channelName}</span>
        </h2>
        <Tooltip content="Membros do grupo">
          <button
            type="button"
            onClick={openMembers}
            aria-label="Membros do grupo"
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

      {detail.chatAvailable && typingNames.length > 0 && (
        // Same line as a room's chat (components/ChatPanel). Taking its row
        // shrinks the conversation, and the ResizeObserver above keeps
        // whoever is reading the newest line on it.
        <p aria-live="polite" className="shrink-0 truncate px-3 pt-1.5 text-xs text-zinc-500 italic">
          {formatTypingLabel(typingNames)}
        </p>
      )}

      {detail.chatAvailable && (
        <GroupMessageComposer
          channelName={channelName}
          candidates={candidates}
          replyingTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          onSend={send}
          disabledReason={can("sendMessages") ? null : "Você não pode enviar mensagens nesta sala."}
          allow={{ gifs: can("sendGifs"), images: can("sendImages") }}
          onTypingChange={can("sendMessages") ? announceTyping : undefined}
        />
      )}

      <ChatImageModal preview={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

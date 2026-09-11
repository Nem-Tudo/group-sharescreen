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
import { MdChatBubbleOutline, MdDeleteOutline, MdPeopleOutline, MdReply } from "react-icons/md";
import { ChatImageModal, type ChatImagePreviewState } from "@/components/ChatImageModal";
import { DisplayUserName } from "@/components/DisplayUserName";
import { Tooltip } from "@/components/Tooltip";
import { UserAvatar } from "@/components/UserAvatar";
import {
  GroupMessageComposer,
  type ComposerPayload,
  type MentionCandidate,
} from "@/components/groups/GroupMessageComposer";
import { openGroupProfile } from "@/components/groups/groupProfile";
import { rememberChannel } from "@/components/groups/lastChannel";
import { buildMentionsRegex, tokenizeMentions } from "@/lib/chatMentions";
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
  sendGroupMessage,
  type GroupDetail,
  type GroupMessage,
  type GroupReplyTo,
  type GroupUser,
} from "@/lib/groupsApi";
import { signalingClient } from "@/lib/signalingClient";
import { onGroupMessage, onGroupMessageDeleted, setViewingChannel } from "@/lib/useGroups";
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

type Pending = { clientId: string; text: string; ts: number; kind: "text" | "gif" | "image" };

const rowAction =
  "inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-zinc-400 opacity-100 transition hover:bg-zinc-200/70 hover:text-zinc-800 active:scale-95 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200";

export function TextChannelView({ detail, channelId }: { detail: GroupDetail; channelId: string }) {
  const { openPopup } = useNtPopups();
  const groupId = detail.group.id;
  const channel = detail.channels.find((c) => c.id === channelId) ?? null;
  const selfId = detail.me.id;
  const isManager = detail.me.role === "owner" || detail.me.role === "admin";

  // Whatever was held for this room from last time. Read once: this component
  // is keyed by the room, so a new room is a new instance and a fresh read.
  const [cached] = useState(() => (detail.chatAvailable ? getCachedChannel(channelId) : null));
  const [messages, setMessages] = useState<GroupMessage[] | null>(cached?.messages ?? null);
  const [authors, setAuthors] = useState<Record<string, GroupUser>>(cached?.authors ?? {});
  const [hasMore, setHasMore] = useState(cached?.hasMore ?? true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [replyTo, setReplyTo] = useState<GroupReplyTo | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [preview, setPreview] = useState<ChatImagePreviewState | null>(null);
  const [unseen, setUnseen] = useState(0);

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
  const heldMembers = useGroupMembers(groupId, `${detail.group.memberCount}:${detail.group.admins.join(",")}`);
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
        if (prev.some((m) => m.id === message.id)) return prev;
        if (atBottomRef.current) pendingScroll.current = { type: "bottom" };
        else if (message.from !== selfId) setUnseen((n) => n + 1);
        return [...prev, message].sort((a, b) => a.ts - b.ts);
      });
    },
    [selfId]
  );

  useEffect(
    () =>
      onGroupMessage((message, author) => {
        if (message.groupId !== groupId || message.channelId !== channelId) return;
        if (author) setAuthors((prev) => ({ ...prev, [author.id]: author }));
        upsert(message);
      }),
    [groupId, channelId, upsert]
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
  }, [messages, pending]);

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

  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const candidates: MentionCandidate[] = useMemo(
    () =>
      members
        .filter((m) => m.id !== selfId)
        .map((m) => ({ id: m.id, name: m.name, avatarUrl: m.avatarUrl })),
    [members, selfId]
  );
  const mentionRegex = useMemo(() => buildMentionsRegex(members.map((m) => m.name)), [members]);

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

  function renderText(message: GroupMessage): ReactNode {
    const tokens = tokenizeMentions(message.text, mentionRegex);
    return tokens.map((token, index) =>
      token.type === "mention" ? (
        <span key={index} className="font-semibold text-blue-600 dark:text-blue-400">
          {token.value}
        </span>
      ) : (
        <Fragment key={index}>{linkify(token.value, `${message.id}-${index}`)}</Fragment>
      )
    );
  }

  // ── Actions ──────────────────────────────────────────────────────────

  async function send(payload: ComposerPayload): Promise<{ ok: boolean; error?: string }> {
    const clientId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const kind = payload.url ? "gif" : payload.images?.length ? "image" : "text";
    pendingScroll.current = { type: "bottom" };
    setPending((prev) => [...prev, { clientId, text: payload.text, ts: Date.now(), kind }]);
    const result = await sendGroupMessage(groupId, channelId, {
      ...payload,
      replyTo,
      // A guest's name is whatever they are going by right now.
      name: detail.me.guest ? signalingClient.getSnapshot().name : null,
    });
    setPending((prev) => prev.filter((p) => p.clientId !== clientId));
    if (!result.ok) return { ok: false, error: result.error };
    setReplyTo(null);
    setAuthors((prev) => ({ ...prev, [result.author.id]: result.author }));
    atBottomRef.current = true;
    upsert(result.message);
    return { ok: true };
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
    const canDelete = message.from === selfId || isManager;
    return (
      <span className="flex shrink-0 items-center">
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
    for (const message of messages) {
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
      const mentionsMe = Boolean(message.mentions?.includes(selfId)) || message.replyTo?.userId === selfId;
      rows.push(
        <li
          key={message.id}
          className={`group relative -mx-1.5 rounded-lg px-2 text-sm transition-colors ${
            grouped ? "pb-0.5" : "mt-2.5 pb-0.5"
          } ${mentionsMe ? "bg-blue-100/70 py-1 dark:bg-blue-500/25" : "hover:bg-zinc-100/80 dark:hover:bg-zinc-900/70"}`}
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
                    color={author.nameColor}
                    className="min-w-0 font-medium text-zinc-700 hover:underline dark:text-zinc-300"
                  />
                  <span className="shrink-0 text-xs tabular-nums text-zinc-400 dark:text-zinc-600">{timeLabel(message.ts)}</span>
                </span>
              </button>
              {actionsFor(message)}
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
                      key={url}
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
            </div>
            {grouped && actionsFor(message)}
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
          {pending.map((p) => (
            <li key={p.clientId} className="-mx-1.5 px-2 pb-0.5 text-sm text-zinc-500 opacity-70">
              <p className="whitespace-pre-wrap break-words">
                {p.text || (p.kind === "gif" ? "Enviando GIF…" : "Enviando imagem…")}
              </p>
            </li>
          ))}
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

      {detail.chatAvailable && (
        <GroupMessageComposer
          channelName={channelName}
          candidates={candidates}
          replyingTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          onSend={send}
        />
      )}

      <ChatImageModal preview={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

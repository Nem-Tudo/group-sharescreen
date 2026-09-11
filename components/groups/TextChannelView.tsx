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
import { MdDeleteOutline, MdMenu, MdPeopleOutline, MdReply, MdTag } from "react-icons/md";
import { AccountMenu } from "@/components/AccountMenu";
import { ChatImageModal, type ChatImagePreviewState } from "@/components/ChatImageModal";
import { DisplayUserName } from "@/components/DisplayUserName";
import { NotificationInboxBell } from "@/components/NotificationInboxBell";
import { Tooltip } from "@/components/Tooltip";
import { UserAvatar } from "@/components/UserAvatar";
import { useGroupNav } from "@/components/groups/groupNav";
import {
  GroupMessageComposer,
  type ComposerPayload,
  type MentionCandidate,
} from "@/components/groups/GroupMessageComposer";
import { rememberChannel } from "@/components/groups/lastChannel";
import { buildMentionsRegex, tokenizeMentions } from "@/lib/chatMentions";
import { verifiedBadge } from "@/lib/entitlements";
import {
  deleteGroupMessage,
  fetchMembers,
  fetchMessages,
  sendGroupMessage,
  type GroupDetail,
  type GroupMember,
  type GroupMessage,
  type GroupReplyTo,
  type GroupUser,
} from "@/lib/groupsApi";
import { signalingClient } from "@/lib/signalingClient";
import { onGroupMessage, onGroupMessageDeleted, setViewingChannel } from "@/lib/useGroups";

// One text room of a group: its history, read a page at a time and extended
// live, and the box to write in. Discord's shape rather than the DM bubbles —
// a face and a name at the head of each run of messages — because a room has
// many voices and the thing a reader scans for is *who* said it.

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
  const label = new Date(ts).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  return label.charAt(0).toUpperCase() + label.slice(1);
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
        className="break-all text-indigo-600 underline-offset-2 hover:underline dark:text-indigo-400"
      >
        {part}
      </a>
    );
  });
}

type Pending = { clientId: string; text: string; ts: number; kind: "text" | "gif" | "image" };

export function TextChannelView({ detail, channelId }: { detail: GroupDetail; channelId: string }) {
  const { openPopup } = useNtPopups();
  const { openNav } = useGroupNav();
  const groupId = detail.group.id;
  const channel = detail.channels.find((c) => c.id === channelId) ?? null;
  const selfId = detail.me.id;
  const isManager = detail.me.role === "owner" || detail.me.role === "admin";

  const [messages, setMessages] = useState<GroupMessage[] | null>(null);
  const [authors, setAuthors] = useState<Record<string, GroupUser>>({});
  const [hasMore, setHasMore] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [replyTo, setReplyTo] = useState<GroupReplyTo | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [preview, setPreview] = useState<ChatImagePreviewState | null>(null);
  const [unseen, setUnseen] = useState(0);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const atBottomRef = useRef(true);
  const olderInFlight = useRef(false);
  const pendingScroll = useRef<{ type: "bottom" } | { type: "preserve"; height: number; top: number } | null>(null);

  // ── Loading ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!detail.chatAvailable) return;
    const controller = new AbortController();
    void fetchMessages(groupId, channelId, undefined, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (!result.ok) {
          setLoadError(result.error);
          setMessages([]);
          return;
        }
        pendingScroll.current = { type: "bottom" };
        setMessages(result.messages);
        setAuthors((prev) => ({ ...prev, ...result.authors }));
        setHasMore(result.messages.length >= 50);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [groupId, channelId, detail.chatAvailable]);

  // Members, for @mention suggestions and for naming authors the page did not carry.
  useEffect(() => {
    const controller = new AbortController();
    void fetchMembers(groupId, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted && result.ok) setMembers(result.members);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [groupId, detail.group.memberCount]);

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

  const upsert = useCallback((message: GroupMessage) => {
    setMessages((prev) => {
      if (!prev) return prev;
      if (prev.some((m) => m.id === message.id)) return prev;
      if (atBottomRef.current) pendingScroll.current = { type: "bottom" };
      else if (message.from !== selfId) setUnseen((n) => n + 1);
      return [...prev, message].sort((a, b) => a.ts - b.ts);
    });
  }, [selfId]);

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
  // other device — and the rail should come back here next time.
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
  const mentionRegex = useMemo(
    () => buildMentionsRegex(members.map((m) => m.name)),
    [members]
  );

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
        <span
          key={index}
          className="rounded bg-indigo-500/15 px-0.5 font-medium text-indigo-700 dark:text-indigo-300"
        >
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
        icon: "🗑️",
        onChoose: async (confirmed: boolean) => {
          if (!confirmed) return;
          const result = await deleteGroupMessage(groupId, channelId, message.id);
          if (result.ok) setMessages((prev) => prev?.filter((m) => m.id !== message.id) ?? prev);
          else void openPopup("generic", { data: { title: "Não deu", message: result.error, icon: "⚠️" } });
        },
      },
    });
  }

  function openSettings(tab: string) {
    void openPopup("group_settings", {
      maxWidth: "min(46rem, calc(100vw - 2rem))",
      width: "min(46rem, calc(100vw - 2rem))",
      maxHeight: "90dvh",
      data: { groupId, tab },
    });
  }

  // ── Render ───────────────────────────────────────────────────────────

  const channelName = channel?.name ?? "sala";

  let body: ReactNode;
  if (!detail.chatAvailable) {
    body = (
      <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
        As salas de texto não estão disponíveis nesta instalação.
      </div>
    );
  } else if (messages === null) {
    body = (
      <div className="flex flex-1 flex-col justify-end gap-4 p-4" aria-hidden>
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-3">
            <span className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
            <span className="flex flex-1 flex-col gap-2">
              <span className="h-3 w-32 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
              <span className="h-3 w-2/3 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
            </span>
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
          <li key={`day-${message.id}`} className="my-3 flex items-center gap-3 px-4" aria-hidden>
            <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
            <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">{dayLabel(message.ts)}</span>
            <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
          </li>
        );
      }
      const author = userOf(message);
      const mentionsMe = Boolean(message.mentions?.includes(selfId)) || message.replyTo?.userId === selfId;
      const canDelete = message.from === selfId || isManager;
      rows.push(
        <li
          key={message.id}
          className={`group/msg relative flex gap-3 px-4 py-0.5 transition hover:bg-zinc-50 dark:hover:bg-zinc-900/60 ${
            grouped ? "" : "mt-3"
          } ${mentionsMe ? "border-l-2 border-amber-500 bg-amber-500/10 hover:bg-amber-500/15 dark:hover:bg-amber-500/15" : ""}`}
        >
          <div className="w-10 shrink-0">
            {grouped ? (
              <span className="invisible block pt-1 text-right text-[10px] text-zinc-400 group-hover/msg:visible">
                {timeLabel(message.ts)}
              </span>
            ) : (
              <UserAvatar
                src={author.avatarUrl}
                name={author.name}
                size={40}
                userId={author.guest ? null : author.id}
                isGuest={author.guest}
              />
            )}
          </div>
          <div className="min-w-0 flex-1">
            {message.replyTo && (
              <p className="mb-0.5 flex min-w-0 items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
                <MdReply className="h-3.5 w-3.5 shrink-0 -scale-x-100" />
                <span className="font-semibold">@{message.replyTo.name}</span>
                <span className="truncate">
                  {message.replyTo.text || (message.replyTo.kind === "gif" ? "GIF" : "Imagem")}
                </span>
              </p>
            )}
            {!grouped && (
              <p className="flex items-baseline gap-2">
                <DisplayUserName
                  name={author.name}
                  isGuest={author.guest}
                  verified={verifiedBadge(author.flags)}
                  color={author.nameColor}
                  className="text-[15px] font-semibold text-zinc-950 dark:text-zinc-50"
                />
                <span className="text-xs text-zinc-400">{timeLabel(message.ts)}</span>
              </p>
            )}
            {message.text && (
              <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-zinc-800 dark:text-zinc-200">
                {renderText(message)}
              </p>
            )}
            {message.kind === "gif" && message.url && (
              <button
                type="button"
                onClick={() => setPreview({ src: message.url!, alt: "GIF" })}
                className="mt-1 block cursor-zoom-in"
                aria-label="Ampliar o GIF"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={message.url} alt="GIF" onLoad={onMediaLoad} className="max-h-60 rounded-lg" />
              </button>
            )}
            {message.images && message.images.length > 0 && (
              <div className={`mt-1 grid max-w-md gap-1 ${message.images.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
                {message.images.map((url, index) => (
                  <button
                    key={url}
                    type="button"
                    onClick={() =>
                      setPreview({ src: url, alt: "Imagem", images: message.images, currentIndex: index })
                    }
                    className="block cursor-zoom-in overflow-hidden rounded-lg"
                    aria-label="Ampliar a imagem"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt="Imagem"
                      onLoad={onMediaLoad}
                      className={`w-full object-cover ${message.images!.length > 1 ? "aspect-square" : "max-h-72 object-contain"}`}
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* What can be done to a message, over its top-right corner on hover. */}
          <div className="absolute -top-3 right-4 hidden items-center gap-0.5 rounded-lg border border-zinc-200 bg-white p-0.5 shadow-sm group-hover/msg:flex dark:border-zinc-800 dark:bg-zinc-900">
            <Tooltip content="Responder">
              <button
                type="button"
                onClick={() => startReply(message)}
                aria-label="Responder"
                className="cursor-pointer rounded-md p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              >
                <MdReply className="h-4 w-4" />
              </button>
            </Tooltip>
            {canDelete && (
              <Tooltip content="Apagar">
                <button
                  type="button"
                  onClick={() => confirmDelete(message)}
                  aria-label="Apagar"
                  className="cursor-pointer rounded-md p-1 text-red-500 hover:bg-red-500/10"
                >
                  <MdDeleteOutline className="h-4 w-4" />
                </button>
              </Tooltip>
            )}
          </div>
        </li>
      );
      previous = message;
    }

    body = (
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
        <ul className="flex min-h-full flex-col justify-end pb-3">
          {!hasMore && (
            <li className="px-4 pb-4 pt-8">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-900">
                <MdTag className="h-8 w-8 text-zinc-500" />
              </span>
              <p className="mt-2 text-2xl font-bold text-zinc-950 dark:text-zinc-50">Bem-vindo a #{channelName}!</p>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Este é o começo da sala #{channelName}.</p>
            </li>
          )}
          {loadingOlder && (
            <li className="py-2 text-center text-xs text-zinc-500 dark:text-zinc-400">Carregando mensagens antigas…</li>
          )}
          {loadError && <li className="px-4 py-2 text-sm text-red-500">{loadError}</li>}
          {rows}
          {pending.map((p) => (
            <li key={p.clientId} className="flex gap-3 px-4 py-0.5 opacity-60">
              <div className="w-10 shrink-0" />
              <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[15px] text-zinc-700 dark:text-zinc-300">
                {p.text || (p.kind === "gif" ? "Enviando GIF…" : "Enviando imagem…")}
              </p>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white dark:bg-zinc-950">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-black/5 px-3 dark:border-white/5">
        <button
          type="button"
          onClick={openNav}
          aria-label="Salas do grupo"
          className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-zinc-600 transition hover:bg-zinc-100 lg:hidden dark:text-zinc-400 dark:hover:bg-zinc-900"
        >
          <MdMenu className="h-5 w-5" />
        </button>
        <MdTag className="h-5 w-5 shrink-0 text-zinc-500" />
        <h1 className="min-w-0 truncate font-semibold text-zinc-950 dark:text-zinc-50">{channelName}</h1>
        <span className="hidden truncate text-sm text-zinc-500 md:inline dark:text-zinc-400">
          · {detail.group.name}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Tooltip content="Membros">
            <button
              type="button"
              onClick={() => openSettings("members")}
              aria-label="Membros"
              className="flex h-9 cursor-pointer items-center gap-1 rounded-lg px-2 text-sm text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
            >
              <MdPeopleOutline className="h-5 w-5" />
              <span className="hidden sm:inline">{detail.group.memberCount}</span>
            </button>
          </Tooltip>
          <NotificationInboxBell />
          <AccountMenu />
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col">
        {body}
        {unseen > 0 && (
          <button
            type="button"
            onClick={scrollToBottom}
            className="absolute bottom-2 left-1/2 -translate-x-1/2 cursor-pointer rounded-full bg-indigo-600 px-3 py-1 text-xs font-medium text-white shadow-lg transition hover:bg-indigo-700"
          >
            {unseen === 1 ? "1 mensagem nova" : `${unseen} mensagens novas`} ↓
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

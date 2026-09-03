"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { MdArrowBack, MdClose, MdGif, MdImage, MdReply, MdSend } from "react-icons/md";
import { GifPicker } from "@/components/GifPicker";
import { Popover } from "@/components/Tooltip";
import {
  CHAT_IMAGE_ACCEPT,
  CHAT_IMAGE_MAX_PER_MESSAGE,
  isSupportedChatImage,
  prepareChatImage,
} from "@/lib/chatImage";
import { DisplayUserName } from "@/components/DisplayUserName";
import { useAuth } from "@/lib/AuthContext";
import { hasVerifiedBadge } from "@/lib/entitlements";
import { openDirectMessages } from "@/lib/dmWindow";
import { useSignaling } from "@/lib/useSignaling";
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

function timeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/** The hover affordance that turns a message into the thing being answered. */
function ReplyButton({
  message,
  name,
  onReply,
}: {
  message: DirectMessage;
  name: string;
  onReply: (reply: DmReplyTo) => void;
}) {
  return (
    <button
      type="button"
      aria-label="Responder"
      onClick={() =>
        onReply({
          id: message.id,
          name,
          // Snapshotted here, from what is on screen. The API re-validates
          // every field of it before storing (see parseDmReplyTo), so this
          // being client-supplied costs nothing.
          ...(message.text ? { text: message.text } : {}),
          ...(message.kind ? { kind: message.kind } : {}),
          ...(message.images ? { images: message.images } : {}),
        })
      }
      className="shrink-0 rounded p-1 text-zinc-400 opacity-0 transition group-hover:opacity-100 hover:bg-zinc-100 hover:text-zinc-700 focus:opacity-100 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
    >
      <MdReply className="h-3.5 w-3.5" />
    </button>
  );
}

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
  const { account } = useAuth();
  const { recentDms } = useSignaling();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  // The loaded thread, tagged with whose it is. Tagging is what lets the
  // "which thread is open" question be answered by the store alone: a thread
  // whose userId does not match the one being asked for is simply stale, and
  // renders as loading rather than having to be cleared by an effect.
  const [thread, setThread] = useState<{
    userId: string;
    user: SocialUser;
    messages: DirectMessage[];
  } | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What is being answered, and what is waiting to go with the next send.
  // Both are cleared together on a successful send: they are one composition.
  const [replyingTo, setReplyingTo] = useState<DmReplyTo | null>(null);
  const [attachments, setAttachments] = useState<{ dataUrl: string }[]>([]);
  const [gifOpen, setGifOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const activeId = openWith ?? null;
  const active = thread?.userId === activeId ? thread.user : null;
  const loaded = thread?.userId === activeId ? thread.messages : null;

  // The fetched page, plus anything that arrived since — derived rather than
  // merged into state, so a message landing while this is open needs no
  // effect and cannot be lost between two renders.
  const messages = useMemo(() => {
    const base = loaded ?? [];
    if (!activeId || !account) return base;
    const seen = new Set(base.map((message) => message.id));
    const extra = recentDms.filter((message) => {
      if (seen.has(message.id)) return false;
      return (
        (message.from === activeId && message.to === account.id) ||
        (message.from === account.id && message.to === activeId)
      );
    });
    return extra.length === 0 ? base : [...base, ...extra];
  }, [loaded, recentDms, activeId, account]);

  // Escape closes the thread first, then the dialog. One key, two steps, so
  // it never throws away more than the person meant.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (activeId) openDirectMessages(null);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, activeId, onClose]);

  // The list, whenever the dialog opens and whenever anything arrives.
  useEffect(() => {
    if (!open || !account) return;
    const controller = new AbortController();
    void fetchConversations(controller.signal).then((data) => {
      if (controller.signal.aborted || !data) return;
      setConversations(data.conversations);
    });
    return () => controller.abort();
  }, [open, account, recentDms]);

  // Loads whichever thread the store is pointing at. Every setState here is
  // inside the promise callback, which is what keeps this out of the
  // "cascading render" pattern a synchronous one would be.
  useEffect(() => {
    if (!open || !activeId) return;
    const controller = new AbortController();
    void fetchConversation(activeId, undefined, controller.signal).then((data) => {
      if (controller.signal.aborted || !data) return;
      setThread({ userId: activeId, user: data.user, messages: data.messages });
      markConversationRead(activeId);
    });
    return () => controller.abort();
  }, [open, activeId]);

  // Whatever arrives for the open thread is already on screen (see the merge
  // above); this only moves the bookmark, which is a write to the server and
  // not to any state here.
  useEffect(() => {
    if (!activeId || !account) return;
    const theirs = recentDms.some(
      (message) => message.from === activeId && message.to === account.id
    );
    if (theirs) markConversationRead(activeId);
  }, [recentDms, activeId, account]);

  // Pinned to the newest line. Only the thread's own box is scrolled — never
  // scrollIntoView, which walks up and moves every scrollable ancestor,
  // including the room behind this dialog.
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages]);

  if (!open) return null;

  async function send(payload: Parameters<typeof sendDirectMessage>[1]) {
    if (!activeId || sending) return;
    setSending(true);
    setError(null);
    const result = await sendDirectMessage(activeId, { ...payload, replyTo: replyingTo });
    if (!result.ok) setError(result.error);
    else {
      // Cleared only on success, so a refused message is still there to fix
      // rather than gone with an error beside an empty box.
      setDraft("");
      setAttachments([]);
      setReplyingTo(null);
    }
    setSending(false);
  }

  async function handleSend(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text && attachments.length === 0) return;
    await send({ text, images: attachments.map((a) => a.dataUrl) });
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    const room = CHAT_IMAGE_MAX_PER_MESSAGE - attachments.length;
    const picked = [...files].slice(0, Math.max(0, room));
    const prepared: { dataUrl: string }[] = [];
    for (const file of picked) {
      if (!isSupportedChatImage(file)) {
        setError("Formato de imagem não suportado.");
        continue;
      }
      try {
        // The same downscale the room chat runs before sending, so a phone
        // photo does not cross the wire at its original size.
        const image = await prepareChatImage(file);
        prepared.push({ dataUrl: image.dataUrl });
      } catch {
        setError("Não foi possível preparar a imagem.");
      }
    }
    if (prepared.length > 0) setAttachments((current) => [...current, ...prepared]);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Mensagens"
        onClick={(e) => e.stopPropagation()}
        className="flex h-[70vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-black/10 bg-white shadow-xl dark:border-white/10 dark:bg-zinc-950"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          {activeId && (
            <button
              type="button"
              onClick={() => openDirectMessages(null)}
              aria-label="Voltar"
              className="-ml-1 rounded-lg p-1 text-zinc-500 transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
            >
              <MdArrowBack className="h-5 w-5" />
            </button>
          )}
          <h2 className="flex-1 truncate text-base font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            {active?.displayName ?? (activeId ? "Carregando…" : "Mensagens")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="-mr-1 rounded-lg p-1 text-zinc-500 transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            <MdClose className="h-5 w-5" />
          </button>
        </div>

        {!activeId ? (
          <div className="flex-1 overflow-y-auto p-2">
            {conversations.length === 0 ? (
              <p className="px-2 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                Nenhuma conversa ainda. Abra o perfil de alguém para começar.
              </p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {conversations.map((conversation) => (
                  <li key={conversation.user.id}>
                    <button
                      type="button"
                      onClick={() => openDirectMessages(conversation.user.id)}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
                    >
                      <span className="min-w-0 flex-1">
                        <DisplayUserName
                          name={conversation.user.displayName}
                          verified={hasVerifiedBadge(conversation.user.flags)}
                          className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100"
                        />
                        <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                          {conversation.lastMessage.text}
                        </span>
                      </span>
                      {conversation.unread > 0 && (
                        <span className="shrink-0 rounded-full bg-red-500 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                          {conversation.unread}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <>
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3">
              {messages.length === 0 ? (
                <p className="py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  Nenhuma mensagem ainda.
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {messages.map((message) => {
                    const mine = message.from === account?.id;
                    return (
                      <li
                        key={message.id}
                        className={`group flex items-end gap-1 ${mine ? "justify-end" : "justify-start"}`}
                      >
                        {/* Reply sits outside the bubble and appears on hover:
                            inside it would take width from every message to
                            serve the few that get answered. */}
                        {mine && (
                          <ReplyButton
                            message={message}
                            name="Voce"
                            onReply={setReplyingTo}
                          />
                        )}
                        <span
                          className={`max-w-[80%] rounded-2xl px-3 py-1.5 text-sm ${
                            mine
                              ? "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950"
                              : "bg-zinc-100 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100"
                          }`}
                        >
                          {message.replyTo && (
                            // A snapshot taken when the reply was sent, not a
                            // pointer (see the API side). It keeps saying what
                            // it said even when the original is far outside
                            // the loaded page.
                            <span
                              className={`mb-1 block border-l-2 pl-2 text-xs opacity-70 ${
                                mine ? "border-white/40" : "border-zinc-400"
                              }`}
                            >
                              <span className="block font-medium">@{message.replyTo.name}</span>
                              <span className="line-clamp-2 break-words">
                                {message.replyTo.text ||
                                  (message.replyTo.kind === "gif" ? "GIF" : "Imagem")}
                              </span>
                            </span>
                          )}
                          {message.kind === "gif" && message.url && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={message.url}
                              alt="GIF"
                              className="mb-1 max-h-56 rounded-lg"
                            />
                          )}
                          {message.images && message.images.length > 0 && (
                            <span className="mb-1 flex flex-col gap-1">
                              {message.images.map((url) => (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  key={url}
                                  src={url}
                                  alt="Imagem"
                                  className="max-h-56 rounded-lg object-contain"
                                />
                              ))}
                            </span>
                          )}
                          {message.text && (
                            <span className="whitespace-pre-wrap break-words">{message.text}</span>
                          )}
                          <span
                            className={`mt-0.5 block text-[10px] ${
                              mine ? "text-white/60 dark:text-zinc-950/60" : "text-zinc-400"
                            }`}
                          >
                            {timeLabel(message.ts)}
                          </span>
                        </span>
                        {!mine && (
                          <ReplyButton
                            message={message}
                            name={active?.displayName ?? ""}
                            onReply={setReplyingTo}
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {replyingTo && (
              <div className="flex shrink-0 items-center gap-2 border-t border-zinc-200 px-3 py-1.5 text-xs dark:border-zinc-800">
                <MdReply className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                <span className="min-w-0 flex-1 truncate text-zinc-500 dark:text-zinc-400">
                  Respondendo a @{replyingTo.name}: {replyingTo.text || "anexo"}
                </span>
                <button
                  type="button"
                  onClick={() => setReplyingTo(null)}
                  aria-label="Cancelar resposta"
                  className="shrink-0 rounded p-0.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
                >
                  <MdClose className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {attachments.length > 0 && (
              // A tray above the box rather than an immediate send, exactly
              // as the room chat does it: a caption can then be written to go
              // with the pictures instead of arriving as a second message.
              <div className="flex shrink-0 gap-2 border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
                {attachments.map((attachment, index) => (
                  <span key={attachment.dataUrl.slice(0, 64) + index} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={attachment.dataUrl}
                      alt="Anexo"
                      className="h-14 w-14 rounded-lg object-cover"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setAttachments((current) => current.filter((_, i) => i !== index))
                      }
                      aria-label="Remover"
                      className="absolute -right-1 -top-1 rounded-full bg-zinc-950 p-0.5 text-white dark:bg-zinc-50 dark:text-zinc-950"
                    >
                      <MdClose className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <form
              onSubmit={handleSend}
              className="flex shrink-0 items-center gap-1.5 border-t border-zinc-200 p-2 dark:border-zinc-800"
            >
              <input
                ref={fileRef}
                type="file"
                accept={CHAT_IMAGE_ACCEPT}
                multiple
                hidden
                onChange={(e) => {
                  void handleFiles(e.target.files);
                  // Reset so picking the same file twice in a row still fires
                  // a change event.
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={attachments.length >= CHAT_IMAGE_MAX_PER_MESSAGE}
                aria-label="Enviar imagem"
                className="shrink-0 rounded-lg p-1.5 text-zinc-700 transition hover:bg-zinc-100 hover:text-zinc-950 disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
              >
                <MdImage className="h-5 w-5" />
              </button>
              <Popover
                open={gifOpen}
                onClose={() => setGifOpen(false)}
                placement="top-start"
                tooltip="GIF"
                content={
                  <div className="w-72 rounded-xl border border-zinc-200 bg-white p-2 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
                    <GifPicker
                      onSelect={(gif) => {
                        setGifOpen(false);
                        // Sent on its own, as the room chat does: a GIF is the
                        // message, not an attachment to one.
                        void send({ url: gif.url });
                      }}
                    />
                  </div>
                }
              >
                <button
                  type="button"
                  onClick={() => setGifOpen((current) => !current)}
                  aria-label="Enviar GIF"
                  className="shrink-0 rounded-lg p-1.5 text-zinc-700 transition hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
                >
                  <MdGif className="h-5 w-5" />
                </button>
              </Popover>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
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
                placeholder={attachments.length > 0 ? "Legenda (opcional)..." : "Mensagem..."}
                maxLength={2000}
                className="min-w-0 flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
              />
              <button
                type="submit"
                disabled={(!draft.trim() && attachments.length === 0) || sending}
                aria-label="Enviar"
                className="shrink-0 rounded-lg bg-zinc-950 p-2 text-white transition hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
              >
                {sending ? (
                  <span
                    aria-hidden
                    className="block h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent"
                  />
                ) : (
                  <MdSend className="h-5 w-5" />
                )}
              </button>
            </form>
            {error && <p className="px-3 pb-2 text-xs text-red-500">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}

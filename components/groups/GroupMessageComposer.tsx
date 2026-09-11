"use client";

import { useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { MdClose, MdGif, MdImage, MdSend } from "react-icons/md";
import { GifPicker } from "@/components/GifPicker";
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

// The box at the bottom of a group's text room. Its own component, modelled on
// the DM composer (components/DirectMessagesModal), with the one thing a group
// has that a DM does not: @mentions of the group's members, which is what the
// "só menções" notification level is built on.

export interface MentionCandidate {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface ComposerPayload {
  text: string;
  url?: string;
  images?: string[];
  mentions: string[];
}

const MAX_LENGTH = 2000;
const MAX_HEIGHT_PX = 176;

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

export function GroupMessageComposer({
  channelName,
  candidates,
  replyingTo,
  onCancelReply,
  onSend,
  disabledReason,
}: {
  channelName: string;
  candidates: MentionCandidate[];
  replyingTo: GroupReplyTo | null;
  onCancelReply: () => void;
  /** Resolves once the server answered; the box keeps what was written on a failure. */
  onSend: (payload: ComposerPayload) => Promise<{ ok: boolean; error?: string }>;
  disabledReason?: string | null;
}) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<{ dataUrl: string; bytes: number }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [gifOpen, setGifOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [highlight, setHighlight] = useState(0);
  const [mentionDismissed, setMentionDismissed] = useState<number | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const trigger = getMentionTriggerInfo(text, cursor);
  const suggestions = useMemo(
    () => (trigger.isTriggered ? filterMentionCandidates(candidates, trigger.query).slice(0, 8) : []),
    [trigger.isTriggered, trigger.query, candidates]
  );
  const mentionOpen =
    trigger.isTriggered && suggestions.length > 0 && mentionDismissed !== trigger.startIndex;
  const disabled = Boolean(disabledReason);

  function resize() {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  }

  function onChange(e: ChangeEvent<HTMLTextAreaElement>) {
    setText(e.target.value.slice(0, MAX_LENGTH));
    setCursor(e.target.selectionStart ?? e.target.value.length);
    setHighlight(0);
    setError(null);
    resize();
  }

  function pickMention(candidate: MentionCandidate) {
    const { newText, newCursorPos } = applyMentionInsertion(text, cursor, trigger.startIndex, candidate.name);
    setText(newText);
    setCursor(newCursorPos);
    requestAnimationFrame(() => {
      const el = textRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(newCursorPos, newCursorPos);
      resize();
    });
  }

  async function send(extra: { url?: string } = {}) {
    if (sending || disabled) return;
    const trimmed = text.trim();
    if (!trimmed && images.length === 0 && !extra.url) return;
    setSending(true);
    setError(null);
    const result = await onSend({
      text: extra.url ? "" : trimmed,
      ...(extra.url ? { url: extra.url } : {}),
      ...(!extra.url && images.length > 0 ? { images: images.map((i) => i.dataUrl) } : {}),
      mentions: extra.url ? [] : mentionedIds(trimmed, candidates),
    });
    setSending(false);
    if (!result.ok) {
      setError(result.error ?? "Não foi possível enviar.");
      return;
    }
    // A GIF goes on its own and leaves whatever was being typed alone.
    if (!extra.url) {
      setText("");
      setImages([]);
      setCursor(0);
      requestAnimationFrame(resize);
    }
    textRef.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
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
      void send();
    }
  }

  async function onPickFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    const room = CHAT_IMAGE_MAX_PER_MESSAGE - images.length;
    if (room <= 0) {
      setError(`No máximo ${CHAT_IMAGE_MAX_PER_MESSAGE} imagens por mensagem.`);
      return;
    }
    const next = [...images];
    for (const file of files.slice(0, room)) {
      if (!isSupportedChatImage(file)) {
        setError("Formato de imagem não suportado.");
        continue;
      }
      try {
        const prepared = await prepareChatImage(file);
        const total = next.reduce((n, i) => n + i.bytes, 0) + prepared.byteLength;
        if (total > CHAT_IMAGE_TOTAL_MAX_BYTES) {
          setError("As imagens passaram do tamanho máximo por mensagem.");
          break;
        }
        next.push({ dataUrl: prepared.dataUrl, bytes: prepared.byteLength });
      } catch {
        setError("Não foi possível ler essa imagem.");
      }
    }
    setImages(next);
    textRef.current?.focus();
  }

  return (
    <div className="relative shrink-0 px-3 pb-3 sm:px-4">
      {mentionOpen && (
        <ul
          role="listbox"
          className="absolute bottom-full left-3 right-3 mb-1 max-h-64 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-1 shadow-lg sm:left-4 sm:right-4 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <li className="px-2 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            Membros
          </li>
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
                className={`flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${
                  index === highlight
                    ? "bg-zinc-100 text-zinc-950 dark:bg-zinc-800 dark:text-zinc-50"
                    : "text-zinc-700 dark:text-zinc-300"
                }`}
              >
                <UserAvatar src={candidate.avatarUrl} name={candidate.name} size={22} />
                <span className="truncate">{candidate.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
        {replyingTo && (
          <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-3 py-1.5 text-xs text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
            <span className="min-w-0 truncate">
              Respondendo a <span className="font-semibold text-zinc-900 dark:text-zinc-100">{replyingTo.name}</span>
              {replyingTo.text ? ` — ${replyingTo.text}` : ""}
            </span>
            <button
              type="button"
              onClick={onCancelReply}
              aria-label="Cancelar resposta"
              className="shrink-0 cursor-pointer rounded-full p-0.5 hover:bg-zinc-200 dark:hover:bg-zinc-800"
            >
              <MdClose className="h-4 w-4" />
            </button>
          </div>
        )}
        {images.length > 0 && (
          <div className="flex gap-2 border-b border-zinc-200 p-2 dark:border-zinc-800">
            {images.map((image, index) => (
              <div key={index} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.dataUrl} alt="Anexo" className="h-16 w-16 rounded-lg object-cover" />
                <button
                  type="button"
                  onClick={() => setImages(images.filter((_, i) => i !== index))}
                  aria-label="Remover imagem"
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-zinc-900 text-white shadow"
                >
                  <MdClose className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-1 px-2 py-1.5">
          <Tooltip content={disabledReason ?? "Enviar imagem"}>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={disabled || sending}
              aria-label="Enviar imagem"
              className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-200 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              <MdImage className="h-5 w-5" />
            </button>
          </Tooltip>
          <input ref={fileRef} type="file" accept={CHAT_IMAGE_ACCEPT} multiple hidden onChange={onPickFiles} />
          <textarea
            ref={textRef}
            value={text}
            onChange={onChange}
            onKeyDown={onKeyDown}
            onSelect={(e) => setCursor(e.currentTarget.selectionStart ?? 0)}
            onClick={(e) => setCursor(e.currentTarget.selectionStart ?? 0)}
            rows={1}
            disabled={disabled}
            placeholder={disabledReason ?? `Conversar em #${channelName}`}
            className="max-h-44 min-h-9 flex-1 resize-none bg-transparent px-1 py-2 text-[15px] text-zinc-950 outline-none placeholder:text-zinc-400 disabled:cursor-not-allowed dark:text-zinc-50"
          />
          <Popover
            open={gifOpen}
            onClose={() => setGifOpen(false)}
            placement="top-end"
            content={
              <GifPicker
                onSelect={(gif) => {
                  setGifOpen(false);
                  void send({ url: gif.url });
                }}
              />
            }
            tooltip="Enviar GIF"
          >
            <button
              type="button"
              onClick={() => setGifOpen((open) => !open)}
              disabled={disabled || sending}
              aria-label="Enviar GIF"
              className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-200 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              <MdGif className="h-6 w-6" />
            </button>
          </Popover>
          <button
            type="button"
            onClick={() => void send()}
            disabled={disabled || sending || (!text.trim() && images.length === 0)}
            aria-label="Enviar"
            className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-indigo-600 text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <MdSend className="h-4.5 w-4.5" />
          </button>
        </div>
      </div>
      {error && <p className="mt-1 px-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}

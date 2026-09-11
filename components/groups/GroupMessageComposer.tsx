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
import { MdClose, MdGif, MdGroups, MdOutlineImage, MdSend } from "react-icons/md";
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
import { EVERYONE_MENTION } from "@/lib/groupPermissions";

// The box at the bottom of a group's text room. Drawn like the room chat's own
// composer (components/ChatPanel) — a text field and small icon buttons along
// the bottom edge of the panel — so writing in a group feels like writing in a
// room. Behaviour follows the DM composer, plus @mentions of the group's
// members, which the "só menções" notification level is built on.

export interface MentionCandidate {
  id: string;
  name: string;
  avatarUrl: string | null;
}

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
  replyingTo,
  onCancelReply,
  onSend,
  disabledReason,
  allow = { gifs: true, images: true },
}: {
  channelName: string;
  candidates: MentionCandidate[];
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
}) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<{ dataUrl: string; bytes: number }[]>([]);
  const [error, setError] = useState<string | null>(null);
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

  function send(extra: { url?: string } = {}) {
    if (disabled) return;
    const trimmed = text.trim();
    if (!trimmed && images.length === 0 && !extra.url) return;
    setError(null);
    onSend({
      text: extra.url ? "" : trimmed,
      ...(extra.url ? { url: extra.url } : {}),
      ...(!extra.url && images.length > 0 ? { images: images.map((i) => i.dataUrl) } : {}),
      mentions: extra.url ? [] : mentionedIds(trimmed, candidates),
    });
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
      setError("Você não tem permissão para enviar imagens nesta sala.");
      return;
    }
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
    <div data-composer className="relative shrink-0 border-t border-zinc-200 p-2 dark:border-zinc-800">
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
                {candidate.id === EVERYONE_MENTION ? (
                  <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-blue-600 text-white">
                    <MdGroups className="h-3 w-3" />
                  </span>
                ) : (
                  <UserAvatar src={candidate.avatarUrl} name={candidate.name} size={18} />
                )}
                <span className="truncate">{candidate.name}</span>
                {candidate.id === EVERYONE_MENTION && (
                  <span className="ml-auto shrink-0 text-[11px] text-zinc-400">avisa todo mundo</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {replyingTo && (
        <div className="mb-1.5 flex items-center justify-between gap-2 rounded-lg bg-zinc-100 px-2.5 py-1 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          <span className="min-w-0 truncate">
            Respondendo <span className="font-medium text-zinc-900 dark:text-zinc-100">@{replyingTo.name}</span>
            {replyingTo.text ? ` — ${replyingTo.text}` : ""}
          </span>
          <button
            type="button"
            onClick={onCancelReply}
            aria-label="Cancelar resposta"
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
              <img src={image.dataUrl} alt="Anexo" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => setImages(images.filter((_, i) => i !== index))}
                aria-label="Remover imagem"
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
        <Tooltip content={disabledReason ?? "Enviar imagem"}>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={disabled}
            aria-label="Enviar imagem"
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
          tooltip="Enviar GIF"
        >
          <button
            type="button"
            onClick={() => setGifOpen((open) => !open)}
            disabled={disabled}
            aria-label="Enviar GIF"
            className={iconButton}
          >
            <MdGif className="h-6 w-6" />
          </button>
        </Popover>
        )}
        <textarea
          ref={textRef}
          value={text}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onSelect={(e) => setCursor(e.currentTarget.selectionStart ?? 0)}
          onClick={(e) => setCursor(e.currentTarget.selectionStart ?? 0)}
          rows={1}
          disabled={disabled}
          placeholder={disabledReason ?? `Mensagem em ${channelName}`}
          className="min-h-12 min-w-0 flex-1 resize-none overflow-y-hidden rounded-lg border border-zinc-300 bg-white px-3 py-[11px] text-base leading-6 text-zinc-950 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-950/10 disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:ring-white/10"
        />
        <button
          type="button"
          onClick={() => send()}
          disabled={disabled || (!text.trim() && images.length === 0)}
          aria-label="Enviar"
          className="mb-1 flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-zinc-950 text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
        >
          <MdSend className="h-4 w-4" />
        </button>
      </div>
      {error && <p className="mt-1 px-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}

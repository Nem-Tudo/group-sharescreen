"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import type { ChatMessage } from "@/lib/signalingClient";
import type { GifResult } from "@/app/api/giphy/search/route";
import { GifPicker } from "@/components/GifPicker";
import { DisplayUserName } from "@/components/DisplayUserName";
import { Popover } from "@/components/Tooltip";

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

const URL_PATTERN = /(https?:\/\/[^\s]+|www\.[^\s]+)/g;
// "@Name" mentions — letters/numbers/underscore covers every display name
// this app accepts, \p{L}/\p{N} (Unicode-aware) so an accented name like
// "@José" still highlights correctly.
const MENTION_PATTERN = /@[\p{L}\p{N}_]+/gu;

// Splits a plain-text (non-URL) segment on "@mentions" and colors just that
// token blue — visible to every reader, not only the person being
// mentioned, so a mention reads as a mention for the whole room.
function highlightMentions(text: string, keyPrefix: string) {
  const parts = text.split(MENTION_PATTERN);
  const mentions = text.match(MENTION_PATTERN) ?? [];
  const out: (string | React.ReactNode)[] = [];
  parts.forEach((part, i) => {
    if (part) out.push(part);
    if (i < mentions.length) {
      out.push(
        <span key={`${keyPrefix}-${i}`} className="font-medium text-blue-600 dark:text-blue-400">
          {mentions[i]}
        </span>
      );
    }
  });
  return out;
}

function linkifyText(text: string) {
  const parts = text.split(URL_PATTERN);
  return parts.map((part, i) => {
    if (!part.match(URL_PATTERN)) return highlightMentions(part, `mention-${i}`);
    const href = part.startsWith("www.") ? `https://${part}` : part;
    return (
      <a
        key={i}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2 hover:text-zinc-950 dark:hover:text-white"
      >
        {part}
      </a>
    );
  });
}

// How long the box waits after the last keystroke before sending an
// explicit "stopped typing" — well under the receiving end's own
// TYPING_EXPIRE_MS safety net (see lib/signalingClient.ts), so under normal
// conditions the indicator always clears via this explicit signal rather
// than that timeout.
const TYPING_IDLE_MS = 3000;

function formatTypingLabel(names: string[]): string {
  if (names.length === 1) return `${names[0]} está digitando...`;
  if (names.length === 2) return `${names[0]} e ${names[1]} estão digitando...`;
  return `${names.length} pessoas estão digitando...`;
}

export function ChatPanel({
  messages,
  selfId,
  selfName,
  onSend,
  onSendGif,
  onTypingChange,
  typingNames,
  blockedMessage,
  sendDisabledReason,
  gifDisabledReason,
  heightClassName = "h-72",
}: {
  messages: ChatMessage[];
  selfId: string | null;
  // Used to detect "@YourName" mentions for the yellow highlight below —
  // omitted for the admin moderation view, which has no identity of its own
  // in the room it's watching.
  selfName?: string | null;
  // Omitted for a read-only viewer (the admin moderation view) — hides the
  // input form instead of sending into a room the viewer isn't a member of.
  onSend?: (text: string) => void;
  onSendGif?: (url: string) => void;
  // Fired at most twice per typing burst — true on the first keystroke,
  // false after TYPING_IDLE_MS of inactivity or on send — not on every
  // change. Omitted (like onSend) for a read-only viewer.
  onTypingChange?: (typing: boolean) => void;
  // Display names of peers the caller already knows are currently typing
  // (see lib/signalingClient.ts's typingPeerIds) — resolved by the caller
  // rather than here, since doing that lookup needs the full peer list this
  // component otherwise has no reason to receive.
  typingNames?: string[];
  // Set when the server rejected the last message for containing a banned
  // word (see signalingClient's chatBlockedMessage) — shown once, right
  // above the input, and cleared by the client on the next send attempt.
  blockedMessage?: string | null;
  // Why this viewer can't send right now, when it isn't about the message
  // itself — today, a room whose owner turned the chat off for ordinary
  // members (see WatchRoom). The composer stays visible but inert, with this
  // shown in its place: hiding it entirely (the way omitting onSend does for
  // the read-only admin view) would just look like the chat broke.
  sendDisabledReason?: string | null;
  // Same, for the GIF button alone — a room can allow talking while
  // disallowing GIFs. Only used as the button's tooltip; the button itself
  // is already disabled by `onSendGif` being omitted.
  gifDisabledReason?: string | null;
  // Lets a caller give this a taller box than the default fixed 18rem — e.g.
  // WatchRoom.tsx's mobile tab view, where chat is the sole content of its
  // pane instead of one of several things stacked in a shared sidebar.
  heightClassName?: string;
}) {
  const [input, setInput] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const isTypingRef = useRef(false);
  const typingIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Held in a ref so the unmount cleanup below always calls the latest
  // handler rather than whichever one was in scope when the effect first ran.
  const onTypingChangeRef = useRef(onTypingChange);
  useEffect(() => {
    onTypingChangeRef.current = onTypingChange;
  }, [onTypingChange]);

  // Sends the "stopped typing" a room is still waiting on if this panel
  // unmounts mid-burst (switching mobile tabs, leaving the room) — without
  // this, everyone else only recovers via signalingClient's own
  // TYPING_EXPIRE_MS fallback instead of right away.
  useEffect(() => {
    return () => {
      if (typingIdleTimerRef.current) clearTimeout(typingIdleTimerRef.current);
      if (isTypingRef.current) onTypingChangeRef.current?.(false);
    };
  }, []);
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Tracks whether we've already jumped to bottom for the current batch of
  // messages, so a room's preloaded history opens scrolled to the bottom
  // (like a real chat) instead of at the top where it first renders.
  const initializedRef = useRef(false);

  // Keeps the newest message in view as they arrive, without fighting the
  // user if they've scrolled up to read older ones.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (messages.length === 0) {
      initializedRef.current = false;
      return;
    }
    if (!initializedRef.current) {
      el.scrollTop = el.scrollHeight;
      initializedRef.current = true;
      return;
    }
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function stopTypingIfNeeded() {
    if (typingIdleTimerRef.current) {
      clearTimeout(typingIdleTimerRef.current);
      typingIdleTimerRef.current = null;
    }
    if (isTypingRef.current) {
      isTypingRef.current = false;
      onTypingChange?.(false);
    }
  }

  function sendInput() {
    if (!input.trim() || !onSend || sendDisabledReason) return;
    onSend(input);
    setInput("");
    stopTypingIfNeeded();
    // Collapses the box back to one line — without this it'd stay grown to
    // whatever height the sent message had reached.
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    sendInput();
  }

  // Enter sends (matching the old single-line input's behavior); Shift+Enter
  // inserts a newline, same convention as every other chat app.
  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendInput();
    }
  }

  // Grows the box with the message (up to a cap, then it scrolls internally)
  // instead of staying a fixed single line like the input it replaced.
  function handleInput(e: FormEvent<HTMLTextAreaElement>) {
    const el = e.currentTarget;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }

  // Announces true on the first keystroke of a burst, then leaves the idle
  // timer above to announce false — not resent on every keystroke, so a
  // continuously-typing peer's indicator just stays on rather than flickering.
  function handleChange(e: ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setInput(value);
    if (!onTypingChange) return;
    if (typingIdleTimerRef.current) clearTimeout(typingIdleTimerRef.current);
    if (!value.trim()) {
      stopTypingIfNeeded();
      return;
    }
    if (!isTypingRef.current) {
      isTypingRef.current = true;
      onTypingChange(true);
    }
    typingIdleTimerRef.current = setTimeout(stopTypingIfNeeded, TYPING_IDLE_MS);
  }

  function handleGifSelect(gif: GifResult) {
    setPickerOpen(false);
    onSendGif?.(gif.url);
  }

  return (
    <div
      className={`mt-4 mb-4 flex ${heightClassName} flex-col overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800`}
      style={{ minHeight: "245px" }}
    >
      <h2 className="border-b border-zinc-200 px-3 py-2 text-sm font-semibold text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">
        Chat
      </h2>

      <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-2">
        {messages.length === 0 ? (
          <p className="my-auto text-center text-sm text-zinc-500 dark:text-zinc-500">
            Nenhuma mensagem ainda.
          </p>
        ) : (
          messages.map((m) => {
            const isSelf = m.from === selfId;
            const isMention =
              !!selfName &&
              m.kind !== "gif" &&
              m.text.toLowerCase().includes(`@${selfName}`.toLowerCase());
            return (
              <div
                key={m.id}
                className={`-mx-1.5 rounded-md px-1.5 py-1 text-sm ${isMention ? "bg-yellow-200 dark:bg-blue-500/25" : ""
                  }`}
              >
                <div className="flex items-baseline gap-1.5">
                  <DisplayUserName
                    name={m.name}
                    isGuest={m.isGuest}
                    verified={m.flags?.includes("VERIFIED")}
                    className={`font-medium ${isSelf ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-700 dark:text-zinc-300"
                      }`}
                  />
                  <span className="text-xs text-zinc-400 dark:text-zinc-600">{formatTime(m.ts)}</span>
                </div>
                {m.kind === "gif" && m.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.url} alt="GIF" className="mt-1 max-h-40 max-w-full rounded-md" />
                ) : (
                  <p className="break-words text-zinc-800 dark:text-zinc-200">{linkifyText(m.text)}</p>
                )}
              </div>
            );
          })
        )}
      </div>

      {blockedMessage && (
        <p className="border-t border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-600 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
          {blockedMessage}
        </p>
      )}

      {typingNames && typingNames.length > 0 && (
        <p className="truncate px-3 pt-1.5 text-xs text-zinc-500 italic dark:text-zinc-500">
          {formatTypingLabel(typingNames)}
        </p>
      )}

      {onSend && (
        <form
          onSubmit={handleSubmit}
          className="flex gap-2 border-t border-zinc-200 p-2 dark:border-zinc-800"
        >
          <Popover
            open={pickerOpen}
            onClose={() => setPickerOpen(false)}
            placement="top-start"
            content={<GifPicker onSelect={handleGifSelect} />}
            tooltip={
              onSendGif
                ? "Adicionar GIF"
                : (gifDisabledReason ?? "Utilize uma conta para enviar GIFs")
            }
          >
            <span className="inline-flex shrink-0">
              <button
                type="button"
                disabled={!onSendGif}
                onClick={() => setPickerOpen((open) => !open)}
                aria-label="Adicionar GIF"
                className={`inline-flex shrink-0 items-center justify-center rounded-md border px-2.5 py-1.5 text-xs font-semibold transition ${onSendGif
                    ? "border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    : "cursor-not-allowed border-zinc-200 text-zinc-400 dark:border-zinc-800 dark:text-zinc-600"
                  }`}
              >
                GIF
              </button>
            </span>
          </Popover>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            maxLength={500}
            rows={1}
            disabled={Boolean(sendDisabledReason)}
            placeholder={sendDisabledReason ?? "Digite uma mensagem..."}
            className="min-w-0 flex-1 resize-none rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-950 outline-none focus:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || Boolean(sendDisabledReason)}
            className="shrink-0 rounded-md bg-zinc-950 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            Enviar
          </button>
        </form>
      )}
    </div>
  );
}

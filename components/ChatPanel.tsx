"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import type { ChatMessage } from "@/lib/signalingClient";
import type { GifResult } from "@/app/api/giphy/search/route";
import { GifPicker } from "@/components/GifPicker";
import { DisplayUserName } from "@/components/DisplayUserName";
import { Popover } from "@/components/Tooltip";
import {
  buildMentionsRegex,
  tokenizeMentions,
  isUserMentionedInMessage,
  getMentionTriggerInfo,
  filterMentionCandidates,
  applyMentionInsertion,
} from "@/lib/chatMentions";

export type ChatPeer = {
  id: string;
  name: string;
  isGuest?: boolean;
  flags?: string[];
  role?: string;
};

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

const URL_PATTERN = /(https?:\/\/[^\s]+|www\.[^\s]+)/g;

// Splits a plain-text segment on valid room member mentions and colors each
// mention token blue. Tokens that do not match an existing participant name
// remain normal plain text.
function linkifyText(text: string, mentionRegex: RegExp | null) {
  const parts = text.split(URL_PATTERN);
  return parts.map((part, i) => {
    if (!part.match(URL_PATTERN)) {
      const tokens = tokenizeMentions(part, mentionRegex);
      return tokens.map((token, j) => {
        if (token.type === "mention") {
          return (
            <span
              key={`mention-${i}-${j}`}
              className="font-medium text-blue-600 dark:text-blue-400"
            >
              {token.value}
            </span>
          );
        }
        return token.value;
      });
    }
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

// How close together two messages from the same person have to be for the
// second to be drawn as a continuation — no repeated name, no repeated clock,
// just the next line. Anything longer than this and the gap in the
// conversation is itself worth showing.
const GROUP_WINDOW_MS = 5 * 60 * 1000;

function formatTypingLabel(names: string[]): string {
  if (names.length === 1) return `${names[0]} está digitando...`;
  if (names.length === 2) return `${names[0]} e ${names[1]} estão digitando...`;
  return `${names.length} pessoas estão digitando...`;
}

export function ChatPanel({
  messages,
  selfId,
  selfName,
  peers = [],
  onSend,
  onSendGif,
  onTypingChange,
  typingNames,
  blockedMessage,
  sendDisabledReason,
  gifDisabledReason,
  heightClassName = "h-72",
  marginClassName = "mt-4 mb-4",
  renderAuthorMenu,
  onAuthorContextMenu,
}: {
  messages: ChatMessage[];
  selfId: string | null;
  // Used to detect "@YourName" mentions for the yellow/blue highlight —
  // omitted for the admin moderation view, which has no identity of its own
  // in the room it's watching.
  selfName?: string | null;
  // Participants in the room used for autocomplete and mention resolution.
  peers?: ChatPeer[];
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
  // The gap this keeps from whatever shares its column. Overridable because
  // it isn't always sharing one: WatchRoom's phone layout gives the chat a
  // sheet of its own, where a margin is just a strip of background between
  // the sheet's edge and its only content.
  marginClassName?: string;
  // Right click on a message opens the room's actions for whoever wrote it
  // (see MemberActionsModal). Omitted where there are none — for a viewer who
  // does not run the room, and for the admin moderation view — so the
  // browser's own menu is left alone rather than replaced by an empty one.
  //
  // Reports the connection id and the name, and lets the caller work out who
  // that is: a message outlives the connection that sent it, and the room's
  // actions are addressed to a person.
  //
  // Two shapes, like ParticipantRow's: `renderAuthorMenu` returns a panel to
  // open beside the message, `onAuthorContextMenu` just reports the click for
  // the caller to handle — which is what a phone gets.
  // Handed a `close`, for the same reason as ParticipantRow's.
  renderAuthorMenu?: (from: string, name: string, close: () => void) => ReactNode;
  onAuthorContextMenu?: (from: string, name: string) => void;
}) {
  const [input, setInput] = useState("");
  // Which message's author menu is open, by message id — one at a time, and
  // keyed on the message rather than the person so two messages from the same
  // author don't both open.
  const [authorMenuFor, setAuthorMenuFor] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Mention autocomplete popup state
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionStartIndex, setMentionStartIndex] = useState<number | null>(null);
  const [mentionMenuOpen, setMentionMenuOpen] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);

  const mentionMenuRef = useRef<HTMLDivElement>(null);
  const activeItemRef = useRef<HTMLButtonElement | null>(null);
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
  // Whether the newest message is on screen, and how much of the log had
  // arrived the last time it was. Both are only knowable from a scroll
  // position, so they're fed by the scroll handler below — an external event
  // — rather than measured from the effect that reacts to new messages,
  // which would be a setState in an effect body (see React's "you might not
  // need an effect").
  const [atBottom, setAtBottom] = useState(true);
  const [readCount, setReadCount] = useState(0);
  // Everything that landed while the reader was scrolled up reading older
  // messages. Derived, not counted: it's exactly the log past the point they
  // last saw the bottom of. Reading back through a busy room used to be
  // silent — the log grew below the fold with nothing saying so, and the only
  // way down was to drag the scrollbar the whole way.
  const pendingBelow = atBottom ? 0 : Math.max(0, messages.length - readCount);

  // Keeps the newest message in view as they arrive, without fighting the
  // user if they've scrolled up to read older ones. Scrolling here fires the
  // handler below, which is what puts `atBottom` back in step.
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

  function handleListScroll() {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAtBottom(nearBottom);
    // Only ever moves forward while the bottom is in view, so scrolling away
    // leaves the mark where the reader actually left off.
    if (nearBottom) setReadCount(messages.length);
  }

  function jumpToLatest() {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setAtBottom(true);
    setReadCount(messages.length);
  }

  // All known member names in the room (peers + self + authors in history)
  // used to construct mention tokenizers and match valid mentions accurately.
  const allKnownNames = useMemo(() => {
    const names = new Set<string>();
    for (const p of peers) {
      if (p.name?.trim()) names.add(p.name.trim());
    }
    if (selfName?.trim()) names.add(selfName.trim());
    for (const m of messages) {
      if (m.name?.trim()) names.add(m.name.trim());
    }
    return Array.from(names);
  }, [peers, selfName, messages]);

  const mentionRegex = useMemo(() => buildMentionsRegex(allKnownNames), [allKnownNames]);

  // Deduplicated candidate list of participants currently in the room for
  // the autocomplete popup.
  const roomParticipants = useMemo(() => {
    const map = new Map<string, ChatPeer>();
    for (const p of peers) {
      if (p.name?.trim()) {
        const key = p.name.trim().toLowerCase();
        if (!map.has(key)) {
          map.set(key, {
            id: p.id,
            name: p.name.trim(),
            isGuest: p.isGuest,
            flags: p.flags,
          });
        }
      }
    }
    if (selfName?.trim()) {
      const key = selfName.trim().toLowerCase();
      if (!map.has(key)) {
        map.set(key, { id: selfId ?? "self", name: selfName.trim() });
      }
    }
    return Array.from(map.values());
  }, [peers, selfName, selfId]);

  // Filtered and ranked autocomplete candidates based on user input after "@"
  const filteredCandidates = useMemo(() => {
    if (!mentionMenuOpen || mentionStartIndex === null) return [];
    return filterMentionCandidates(roomParticipants, mentionQuery);
  }, [mentionMenuOpen, mentionStartIndex, roomParticipants, mentionQuery]);

  const selectedIndex =
    filteredCandidates.length > 0
      ? Math.min(mentionIndex, filteredCandidates.length - 1)
      : 0;

  // Automatically scrolls the active selected candidate into view inside the
  // minimalist scrollable container during keyboard navigation.
  useEffect(() => {
    if (activeItemRef.current) {
      activeItemRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  // Dismisses autocomplete popup if user clicks anywhere outside of it
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        mentionMenuRef.current &&
        !mentionMenuRef.current.contains(e.target as Node) &&
        textareaRef.current &&
        !textareaRef.current.contains(e.target as Node)
      ) {
        setMentionMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function updateMentionTrigger(text: string, cursorPos: number) {
    const trigger = getMentionTriggerInfo(text, cursorPos);
    if (trigger.isTriggered) {
      setMentionStartIndex(trigger.startIndex);
      setMentionQuery(trigger.query);
      setMentionIndex(0);
      setMentionMenuOpen(true);
    } else {
      setMentionMenuOpen(false);
      setMentionStartIndex(null);
      setMentionQuery("");
      setMentionIndex(0);
    }
  }

  function handleSelectMention(selectedName: string) {
    if (mentionStartIndex === null || !textareaRef.current) return;
    const cursorPos = textareaRef.current.selectionStart ?? input.length;
    const { newText, newCursorPos } = applyMentionInsertion(
      input,
      cursorPos,
      mentionStartIndex,
      selectedName
    );
    setInput(newText);
    setMentionMenuOpen(false);
    setMentionStartIndex(null);
    setMentionQuery("");

    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
      }
    });
  }

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
    setMentionMenuOpen(false);
    setMentionStartIndex(null);
    setMentionQuery("");
    stopTypingIfNeeded();
    // Collapses the box back to one line — without this it'd stay grown to
    // whatever height the sent message had reached.
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    sendInput();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionMenuOpen && filteredCandidates.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((prev) => (prev + 1) % filteredCandidates.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((prev) => (prev - 1 + filteredCandidates.length) % filteredCandidates.length);
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        const selected = filteredCandidates[selectedIndex];
        if (selected) {
          handleSelectMention(selected.name);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionMenuOpen(false);
        return;
      }
    }

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

    const cursorPos = e.target.selectionStart ?? value.length;
    updateMentionTrigger(value, cursorPos);

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

  function handleKeyUp(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key) && mentionMenuOpen) {
      return;
    }
    const cursorPos = e.currentTarget.selectionStart ?? e.currentTarget.value.length;
    updateMentionTrigger(e.currentTarget.value, cursorPos);
  }

  function handleClick(e: ReactMouseEvent<HTMLTextAreaElement>) {
    const cursorPos = e.currentTarget.selectionStart ?? e.currentTarget.value.length;
    updateMentionTrigger(e.currentTarget.value, cursorPos);
  }

  function handleGifSelect(gif: GifResult) {
    setPickerOpen(false);
    onSendGif?.(gif.url);
  }

  return (
    <div
      className={`${marginClassName} flex ${heightClassName} flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950`}
      style={{ minHeight: "245px" }}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Chat</h2>
        {messages.length > 0 && (
          <span className="text-xs tabular-nums text-zinc-400 dark:text-zinc-600">
            {messages.length}
          </span>
        )}
      </div>

      {/* `relative` so the "jump to the newest" pill below can hang over the
          bottom of the log without taking a row of it. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={listRef}
          onScroll={handleListScroll}
          className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-2"
        >
          {messages.length === 0 ? (
            <p className="my-auto text-center text-sm text-zinc-500 dark:text-zinc-500">
              Nenhuma mensagem ainda.
            </p>
          ) : (
            messages.map((m, i) => {
              const isSelf = m.from === selfId;
              const isMention =
                !isSelf &&
                Boolean(selfName) &&
                m.kind !== "gif" &&
                isUserMentionedInMessage(m.text, selfName, allKnownNames);
              // Someone typing three lines in a row is one person saying one
              // thing — repeating their name and the same clock time above
              // each line spent three quarters of a narrow column restating
              // what the line before already said. A continuation just
              // indents under the name that's already there; the gap above a
              // new speaker is what separates them now.
              const previous = messages[i - 1];
              const grouped =
                Boolean(previous) &&
                previous.from === m.from &&
                previous.name === m.name &&
                m.ts - previous.ts < GROUP_WINDOW_MS;
              const hasMenu = Boolean(renderAuthorMenu || onAuthorContextMenu);
              const row = (
                <div
                  key={m.id}
                  // Right click anywhere on somebody's message opens the room's
                  // actions for them — the same menu the participant list
                  // offers, reachable from where you actually noticed them.
                  onContextMenu={
                    hasMenu
                      ? (e) => {
                          e.preventDefault();
                          if (renderAuthorMenu) setAuthorMenuFor((open) => (open === m.id ? null : m.id));
                          else onAuthorContextMenu?.(m.from, m.name);
                        }
                      : undefined
                  }
                  title={hasMenu ? "Clique com o botão direito para ver as ações" : undefined}
                  className={`-mx-1.5 rounded-md px-1.5 text-sm ${grouped ? "pb-0.5" : "mt-2.5 pb-0.5 first:mt-0"
                    } ${isMention ? "bg-yellow-200 py-1 dark:bg-blue-500/25" : ""} ${
                      // Same affordance as a participant row, for the same
                      // reason — the actions hang off the message's author.
                      hasMenu
                        ? "cursor-pointer transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
                        : ""
                    }`}
                >
                  {!grouped && (
                    <div className="flex items-baseline gap-1.5">
                      <DisplayUserName
                        name={m.name}
                        isGuest={m.isGuest}
                        verified={m.flags?.includes("VERIFIED")}
                        className={`min-w-0 font-medium ${isSelf
                          ? "text-emerald-700 dark:text-emerald-400"
                          : "text-zinc-700 dark:text-zinc-300"
                          }`}
                      />
                      <span className="shrink-0 text-xs text-zinc-400 tabular-nums dark:text-zinc-600">
                        {formatTime(m.ts)}
                      </span>
                    </div>
                  )}
                  {m.kind === "gif" && m.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.url} alt="GIF" className="mt-1 max-h-40 max-w-full rounded-md" />
                  ) : (
                    <p className="break-words text-zinc-800 dark:text-zinc-200">
                      {linkifyText(m.text, mentionRegex)}
                    </p>
                  )}
                </div>
              );

              if (!renderAuthorMenu) return row;
              // Anchored to the message, opening into the room rather than
              // over the rest of the conversation.
              return (
                <Popover
                  key={m.id}
                  open={authorMenuFor === m.id}
                  onClose={() => setAuthorMenuFor(null)}
                  // Opens *into the chat column*, not out of it. "left-start"
                  // sent a 288px panel sideways over the video stage, which is
                  // both the wrong place to look and the one direction where
                  // it can end up over a tile rather than over the
                  // conversation it belongs to. Below the message keeps it
                  // where the eye already is, and Tippy flips it above near
                  // the bottom of the list.
                  placement="bottom-start"
                  content={
                    authorMenuFor === m.id
                      ? renderAuthorMenu(m.from, m.name, () => setAuthorMenuFor(null))
                      : null
                  }
                >
                  {row}
                </Popover>
              );
            })
          )}
        </div>

        {/* Only while the newest message is actually off screen. Says how
            many arrived while you were reading back, so "nothing happened"
            and "eleven messages happened" don't look the same. */}
        {!atBottom && messages.length > 0 && (
          <button
            type="button"
            onClick={jumpToLatest}
            className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-zinc-950 px-3 py-1.5 text-xs font-medium text-white shadow-lg transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            {pendingBelow > 0
              ? `${pendingBelow} nova${pendingBelow > 1 ? "s" : ""} mensage${pendingBelow > 1 ? "ns" : "m"}`
              : "Ir para o final"}
            <span aria-hidden>↓</span>
          </button>
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
          // items-end, so the GIF and send buttons stay on the last line as
          // the box grows with a long message (see handleInput) instead of
          // floating in the middle of it.
          className="relative flex shrink-0 items-end gap-2 border-t border-zinc-200 p-2 dark:border-zinc-800"
        >
          {/* Autocomplete mention popup */}
          {mentionMenuOpen && filteredCandidates.length > 0 && (
            <div
              ref={mentionMenuRef}
              role="listbox"
              aria-label="Membros para mencionar"
              className="absolute bottom-full left-2 mb-1.5 flex w-60 max-w-[calc(100vw-2rem)] max-h-48 flex-col overflow-y-auto rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-800 dark:bg-zinc-900 z-30 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
            >
              <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                Membros na sala
              </div>
              {filteredCandidates.map((peer, idx) => {
                const isSelected = idx === selectedIndex;
                return (
                  <button
                    key={peer.id || peer.name}
                    ref={isSelected ? activeItemRef : null}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleSelectMention(peer.name);
                    }}
                    onMouseEnter={() => setMentionIndex(idx)}
                    className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition cursor-pointer ${
                      isSelected
                        ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50 font-medium"
                        : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800/50"
                    }`}
                  >
                    <DisplayUserName
                      name={peer.name}
                      isGuest={peer.isGuest}
                      verified={peer.flags?.includes("VERIFIED")}
                      className="truncate"
                    />
                    <span className="shrink-0 text-[10px] text-zinc-400 dark:text-zinc-500 font-mono">
                      Tab ↵
                    </span>
                  </button>
                );
              })}
            </div>
          )}

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
                className={`inline-flex h-8 shrink-0 items-center justify-center rounded-lg border px-2.5 text-xs font-semibold transition ${
                  onSendGif
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
            onKeyUp={handleKeyUp}
            onClick={handleClick}
            onInput={handleInput}
            maxLength={500}
            rows={1}
            disabled={Boolean(sendDisabledReason)}
            placeholder={sendDisabledReason ?? "Digite uma mensagem..."}
            className="min-h-8 min-w-0 flex-1 resize-none rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-sm leading-5 text-zinc-950 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-950/10 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:ring-white/10"
          />
          <button
            type="submit"
            disabled={!input.trim() || Boolean(sendDisabledReason)}
            className="h-8 shrink-0 rounded-lg bg-zinc-950 px-3 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            Enviar
          </button>
        </form>
      )}
    </div>
  );
}

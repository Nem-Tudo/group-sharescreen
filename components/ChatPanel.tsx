"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import type { ChatMessage, ChatReplyTo } from "@/lib/signalingClient";
import type { GifResult } from "@/app/api/giphy/search/route";
import { MdSend } from "react-icons/md";
import { GifPicker } from "@/components/GifPicker";
import {
  CHAT_IMAGE_ACCEPT,
  CHAT_IMAGE_MAX_BYTES,
  CHAT_IMAGE_MAX_PER_MESSAGE,
  CHAT_IMAGE_TOTAL_MAX_BYTES,
  isSupportedChatImage,
  prepareChatImage,
} from "@/lib/chatImage";
import { DisplayUserName } from "@/components/DisplayUserName";
import { withDeviceSuffix } from "@/lib/displayName";
import { Popover, Tooltip } from "@/components/Tooltip";
import { NotificationBell } from "@/components/NotificationBell";
import { MdClose, MdOutlineImage, MdReply } from "react-icons/md";
import { LuPanelRightClose } from "react-icons/lu";
import {
  buildMentionsRegex,
  tokenizeMentions,
  isUserMentionedInMessage,
  getMentionTriggerInfo,
  filterMentionCandidates,
  applyMentionInsertion,
} from "@/lib/chatMentions";
import { hasVerifiedBadge } from "@/lib/entitlements";

type ChatAttachment = {
  id: number;
  name: string;
  // Absent while the downscale is still running (see prepareChatImage).
  dataUrl?: string;
  byteLength: number;
  pending: boolean;
};

export type ChatPeer = {
  id: string;
  name: string;
  userId?: string;
  device?: number;
  isGuest?: boolean;
  flags?: string[];
  nameColor?: string | null;
  role?: string;
  isBroadcast?: boolean;
  description?: string;
  aliases?: string[];
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

// The pictures a message carries, whichever way it says so: `images` is what
// a current server sends, and a lone `url` under kind "image" is the older
// shape still sitting in room histories.
function messageImages(m: ChatMessage): string[] {
  if (m.images && m.images.length > 0) return m.images;
  return m.kind === "image" && m.url ? [m.url] : [];
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
  deviceCounts,
  onOpenProfile,
  onSend,
  onSendGif,
  onSendImages,
  onTypingChange,
  typingNames,
  blockedMessage,
  sendDisabledReason,
  gifDisabledReason,
  imageDisabledReason,
  heightClassName = "h-72",
  marginClassName = "mt-4 mb-4",
  renderAuthorMenu,
  onAuthorContextMenu,
  onCollapse,
  onRequestAccount,
}: {
  messages: ChatMessage[];
  selfId: string | null;
  // Used to detect "@YourName" mentions for the yellow/blue highlight —
  // omitted for the admin moderation view, which has no identity of its own
  // in the room it's watching.
  selfName?: string | null;
  // Participants in the room used for autocomplete and mention resolution.
  peers?: ChatPeer[];
  onCollapse?: () => void;
  // How many devices each identity has in the room right now (see
  // lib/displayName.ts's countDevicesByOwner). Passed in rather than counted
  // from `peers` here, because `peers` deliberately excludes this client and
  // the count has to include it — otherwise your own second device would be
  // the one thing in the room that never says which one it is.
  deviceCounts: Map<string, number>;
  // Open the sender's profile. Same handler the participant list gets — see
  // ParticipantRow's own prop. Absent in the admin console's copy of this
  // panel, where the names simply stay unclickable as they always were.
  onOpenProfile?: (userId: string) => void;
  // Omitted for a read-only viewer (the admin moderation view) — hides the
  // input form instead of sending into a room the viewer isn't a member of.
  onSend?: (text: string, replyTo?: ChatReplyTo | null) => void;
  onSendGif?: (url: string, replyTo?: ChatReplyTo | null) => void;
  // Sends one message made of whatever was typed plus the pictures sitting
  // in the tray, as `data:` URLs already downscaled by this component. Used
  // *instead of* onSend whenever there is at least one attachment, because
  // the caption travels with its pictures in a single request — see
  // lib/chatImage.ts's sendChatImages for why they can't be two messages.
  //
  // It answers rather than throws so a refusal ("imagem muito grande", a CDN
  // that's down) can be shown in place instead of vanishing into a console;
  // on a failure the composer keeps the text and the attachments, so the
  // retry is one more click rather than picking three files again. Omitted
  // the same way onSendGif is, which is what disables the button.
  onSendImages?: (
    text: string,
    images: string[],
    replyTo?: ChatReplyTo | null
  ) => Promise<{ ok: boolean; error?: string }>;
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
  // Same again, for the image button — a room can allow GIFs and not
  // uploads, or the other way round.
  imageDisabledReason?: string | null;
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
  onRequestAccount?: () => void;
}) {
  const [input, setInput] = useState("");
  // Which message's author menu is open, by message id — one at a time, and
  // keyed on the message rather than the person so two messages from the same
  // author don't both open.
  const [authorMenuFor, setAuthorMenuFor] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // The attachment tray: pictures picked or pasted but not sent yet. They sit
  // above the input until the message goes, which is what lets a caption and
  // its pictures leave together — and what lets somebody change their mind
  // about one of three without losing the other two.
  //
  // Each entry holds the downscaled `data:` URL rather than the File: the
  // shrinking happens once, on attach, so the preview shown is exactly what
  // will be sent and the send itself has nothing left to compute. `pending`
  // is that shrink still running.
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [sendingImages, setSendingImages] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  // Only ever counts up, and only to give each attachment a stable React key
  // — two copies of the same file are two attachments.
  const attachmentSeqRef = useRef(0);

  // Mention autocomplete popup state
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionStartIndex, setMentionStartIndex] = useState<number | null>(null);
  const [mentionMenuOpen, setMentionMenuOpen] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  // Whether the user has actively moved through the suggestion list (arrows).
  // It decides what Enter means while the popup is open: with no navigation
  // Enter sends the message (the common case — you typed "@joão" and want to
  // post it), and only after arrowing to a name, or pressing Tab, does Enter
  // insert that name. Reset every time the query changes, so each fresh
  // "@..." starts out "Enter sends".
  const [mentionNavigated, setMentionNavigated] = useState(false);

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
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  // Active message being replied to (Discord style)
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  // Temporarily highlighted message when clicking on a reply reference
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, []);

  function startReply(message: ChatMessage) {
    setReplyingTo(message);
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        try {
          textareaRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
        } catch {}
      }
    });
  }

  function cancelReply() {
    setReplyingTo(null);
  }

  function scrollToMessage(targetId: string) {
    const el = document.getElementById(`chat-msg-${targetId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightedMessageId(targetId);
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = setTimeout(() => {
        setHighlightedMessageId(null);
      }, 1600);
    }
  }

  function getReplyToPayload(): ChatReplyTo | null {
    if (!replyingTo) return null;
    return {
      id: replyingTo.id,
      name: replyingTo.name,
      text: replyingTo.text ? replyingTo.text.slice(0, 200) : "",
      kind: replyingTo.kind,
      images: replyingTo.images && replyingTo.images.length > 0 ? replyingTo.images : undefined,
    };
  }

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
    names.add("todos");
    names.add("everyone");
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
  // the autocomplete popup, prepended with broadcast options.
  const roomParticipants = useMemo(() => {
    const broadcastOptions: ChatPeer[] = [
      {
        id: "__mention_todos__",
        name: "todos",
        aliases: ["everyone"],
        isBroadcast: true,
        description: "Mencionar todos na chamada",
      },
    ];

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
            nameColor: p.nameColor,
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
    return [...broadcastOptions, ...Array.from(map.values())];
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
      setMentionNavigated(false);
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

  // Everything the composer resets once a message is on its way. Not called
  // on a failed image send: the text and the tray are what the retry is made
  // of, and clearing them would throw the message away to report that it
  // didn't go.
  function clearComposer() {
    setInput("");
    setReplyingTo(null);
    setMentionMenuOpen(false);
    setMentionStartIndex(null);
    setMentionQuery("");
    stopTypingIfNeeded();
    // Collapses the box back to one line — without this it'd stay grown to
    // whatever height the sent message had reached.
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }

  async function sendWithAttachments() {
    if (!onSendImages || sendingImages) return;
    const ready = attachments.filter((entry) => entry.dataUrl);
    if (ready.length === 0) return;
    const total = ready.reduce((sum, entry) => sum + entry.byteLength, 0);
    if (total > CHAT_IMAGE_TOTAL_MAX_BYTES) {
      const mb = Math.round(CHAT_IMAGE_TOTAL_MAX_BYTES / (1024 * 1024));
      setImageError(`As imagens somam mais do que o limite de ${mb} MB por mensagem.`);
      return;
    }

    // Read before the await, because the box is cleared optimistically below
    // and would otherwise be empty by the time the request is built.
    const text = input.trim();
    const replyPayload = getReplyToPayload();
    setImageError(null);
    setSendingImages(true);
    try {
      const result = await onSendImages(
        text,
        ready.map((entry) => entry.dataUrl as string),
        replyPayload
      );
      if (result.ok) {
        setAttachments([]);
        clearComposer();
      } else {
        setImageError(result.error ?? "Não foi possível enviar a imagem.");
      }
    } finally {
      setSendingImages(false);
    }
  }

  function sendInput() {
    if (sendDisabledReason || sendingImages) return;
    // A message with pictures goes as one request, caption included — never
    // as a socket message plus a separate upload.
    if (attachments.length > 0) {
      if (attachments.some((entry) => entry.pending)) return;
      void sendWithAttachments();
      return;
    }
    if (!input.trim() || !onSend) return;
    const replyPayload = getReplyToPayload();
    onSend(input, replyPayload);
    clearComposer();
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    sendInput();
  }

  const trayFull = attachments.length >= CHAT_IMAGE_MAX_PER_MESSAGE;
  const canAttach = Boolean(onSendImages) && !trayFull && !sendingImages;
  // A message needs *something* in it — text or a picture — and every picture
  // in the tray has to have finished shrinking before any of them can go.
  const canSend =
    !sendDisabledReason &&
    !sendingImages &&
    (attachments.length > 0
      ? Boolean(onSendImages) && !attachments.some((entry) => entry.pending)
      : Boolean(input.trim()));

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionMenuOpen && filteredCandidates.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionNavigated(true);
        setMentionIndex((prev) => (prev + 1) % filteredCandidates.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionNavigated(true);
        setMentionIndex((prev) => (prev - 1 + filteredCandidates.length) % filteredCandidates.length);
        return;
      }
      // Tab always accepts the highlighted name; Enter only accepts once the
      // user has arrowed into the list. Enter without navigation falls through
      // to the send branch below, so typing "@joão" and pressing Enter posts
      // the message instead of silently swallowing the keystroke to re-insert
      // a name that is already there.
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey && mentionNavigated)) {
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

    if (e.key === "Escape" && replyingTo) {
      e.preventDefault();
      setReplyingTo(null);
      return;
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
    const replyPayload = getReplyToPayload();
    onSendGif?.(gif.url, replyPayload);
    setReplyingTo(null);
  }

  // Puts files in the tray. Nothing is uploaded here — that happens on send.
  async function attachFiles(files: File[]) {
    if (!onSendImages || files.length === 0) return;
    setImageError(null);

    const room = CHAT_IMAGE_MAX_PER_MESSAGE - attachments.length;
    if (room <= 0) {
      setImageError(`Máximo de ${CHAT_IMAGE_MAX_PER_MESSAGE} imagens por mensagem.`);
      return;
    }
    // Takes what fits and says so, rather than refusing the whole drop: three
    // of five pictures is closer to what was asked for than none of them.
    const accepted = files.slice(0, room);
    if (files.length > accepted.length) {
      setImageError(`Máximo de ${CHAT_IMAGE_MAX_PER_MESSAGE} imagens por mensagem.`);
    }

    for (const file of accepted) {
      if (!isSupportedChatImage(file)) {
        setImageError("Formato não suportado. Envie PNG, JPG, WEBP, GIF ou AVIF.");
        continue;
      }
      const id = (attachmentSeqRef.current += 1);
      // In the tray before it has been read, so three big files show three
      // placeholders filling in rather than nothing at all for a moment.
      // Truncated inside the updater rather than trusted from the `room`
      // computed above: two pastes in the same tick would both read the same
      // stale length, and this is the one place that can see the real one.
      // A file that loses that race is simply dropped — the "too many"
      // message above has already been shown.
      setAttachments((current) =>
        [...current, { id, name: file.name, byteLength: file.size, pending: true }].slice(
          0,
          CHAT_IMAGE_MAX_PER_MESSAGE
        )
      );
      try {
        const prepared = await prepareChatImage(file);
        if (prepared.byteLength > CHAT_IMAGE_MAX_BYTES) {
          const mb = Math.round(CHAT_IMAGE_MAX_BYTES / (1024 * 1024));
          setImageError(`Imagem muito grande (máximo ${mb} MB por imagem).`);
          setAttachments((current) => current.filter((entry) => entry.id !== id));
          continue;
        }
        setAttachments((current) =>
          current.map((entry) =>
            entry.id === id
              ? { ...entry, dataUrl: prepared.dataUrl, byteLength: prepared.byteLength, pending: false }
              : entry
          )
        );
      } catch {
        setImageError("Não foi possível ler essa imagem.");
        setAttachments((current) => current.filter((entry) => entry.id !== id));
      }
    }
  }

  function removeAttachment(id: number) {
    setAttachments((current) => current.filter((entry) => entry.id !== id));
    setImageError(null);
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    // Cleared before anything else, so picking the *same* file twice in a
    // row still fires a change event the second time.
    e.target.value = "";
    void attachFiles(files);
  }

  // Ctrl+V of a screenshot, which is how most images actually get into a
  // chat. Only takes over the paste when the clipboard really carries an
  // image — a copied <img> from a web page arrives as image data *and* HTML,
  // and pasting text has to keep working untouched.
  function handlePaste(e: ReactClipboardEvent<HTMLTextAreaElement>) {
    if (!onSendImages) return;
    const files = Array.from(e.clipboardData?.files ?? []).filter((f) =>
      f.type.startsWith("image/")
    );
    if (files.length === 0) return;
    e.preventDefault();
    void attachFiles(files);
  }

  return (
    <div
      className={`${marginClassName} flex ${heightClassName} flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950`}
      style={{ minHeight: "180px" }}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Chat</h2>
        <div className="flex items-center gap-1.5">
          {messages.length > 0 && (
            <span className="text-xs tabular-nums text-zinc-400 dark:text-zinc-600">
              {messages.length}
            </span>
          )}
          <NotificationBell />
          {onCollapse && (
            <Tooltip content="Ocultar chat e perfil">
              <button
                type="button"
                onClick={onCollapse}
                aria-label="Ocultar chat e perfil"
                className="rounded-lg p-1 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              >
                <LuPanelRightClose className="h-4 w-4" />
              </button>
            </Tooltip>
          )}
        </div>
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
                typeof selfName === "string" &&
                m.kind !== "image" &&
                isUserMentionedInMessage(m.text, selfName, allKnownNames);
              const isReplyToMe =
                !isSelf &&
                typeof selfName === "string" &&
                m.replyTo?.name.trim().toLowerCase() === selfName.trim().toLowerCase();
              const isMentionToMe = isMention || isReplyToMe;
              const isHighlighted = highlightedMessageId === m.id;

              // Someone typing three lines in a row is one person saying one
              // thing — repeating their name and the same clock time above
              // what the line before already said. A continuation just
              // indents under the name that's already there; the gap above a
              // new speaker is what separates them now.
              // Replies always show their author and spine (matching Discord).
              const previous = messages[i - 1];
              const grouped =
                !m.replyTo &&
                Boolean(previous) &&
                previous.from === m.from &&
                previous.name === m.name &&
                m.ts - previous.ts < GROUP_WINDOW_MS;
              const hasMenu = Boolean(renderAuthorMenu || onAuthorContextMenu);
              const row = (
                <div
                  key={m.id}
                  id={`chat-msg-${m.id}`}
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
                  className={`group relative -mx-1.5 rounded-lg px-2 text-sm transition-colors duration-150 ${
                    grouped ? "pb-0.5" : "mt-2.5 pb-0.5 first:mt-0"
                  } ${
                    isHighlighted
                      ? "bg-zinc-200/70 ring-1 ring-zinc-400/60 dark:bg-zinc-800 dark:ring-zinc-600"
                      : isMentionToMe
                        ? "bg-blue-100/70 py-1 dark:bg-blue-500/25"
                        : "hover:bg-zinc-100/80 dark:hover:bg-zinc-900/70"
                  } ${
                    hasMenu
                      ? "cursor-pointer"
                      : ""
                  }`}
                >
                  {/* Quoted reply header (Discord style) */}
                  {m.replyTo && (
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        scrollToMessage(m.replyTo!.id);
                      }}
                      className="group/reply mb-1 flex max-w-full cursor-pointer items-center gap-1.5 text-xs text-zinc-500 select-none hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                      title="Clique para ir para a mensagem original"
                    >
                      <div className="flex items-center text-zinc-400 dark:text-zinc-600">
                        <svg
                          className="h-3.5 w-3.5 shrink-0 text-zinc-300 dark:text-zinc-600"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M 4 19 V 9 A 5 5 0 0 1 9 4 H 20" />
                        </svg>
                      </div>
                      <span className="font-medium text-zinc-700 group-hover/reply:underline group-hover/reply:text-zinc-900 dark:text-zinc-300 dark:group-hover/reply:text-white">
                        @{m.replyTo.name}
                      </span>
                      <span className="truncate text-zinc-400 group-hover/reply:text-zinc-600 dark:text-zinc-500 dark:group-hover/reply:text-zinc-300">
                        {m.replyTo.text ? (
                          m.replyTo.text
                        ) : m.replyTo.kind === "gif" ? (
                          <span className="italic">[GIF]</span>
                        ) : (m.replyTo.images && m.replyTo.images.length > 0) || m.replyTo.kind === "image" ? (
                          <span className="italic">[Imagem]</span>
                        ) : (
                          <span className="italic">[Mensagem]</span>
                        )}
                      </span>
                    </div>
                  )}
                  {!grouped && (
                    <div className="flex items-center justify-between gap-1.5">
                      <div className="flex min-w-0 items-baseline gap-1.5">
                        {/* Clickable only for a real account: a guest has no
                            profile to open, and `userId` is absent on messages
                            from before it was sent at all. Both keep the plain
                            name rather than a control that would 404. */}
                        {onOpenProfile && m.userId && !m.isGuest ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              // The message row may itself open the moderation
                              // menu on click — see hasMenu below.
                              e.stopPropagation();
                              onOpenProfile(m.userId as string);
                            }}
                            className="min-w-0 cursor-pointer text-left"
                          >
                            <DisplayUserName
                              name={withDeviceSuffix(m.name, m.userId, m.device, deviceCounts)}
                              isGuest={m.isGuest}
                              verified={hasVerifiedBadge(m?.flags)}
                              color={m.nameColor}
                              className={"min-w-0 font-medium text-zinc-700 hover:underline dark:text-zinc-300"}
                            />
                          </button>
                        ) : (
                          <DisplayUserName
                            name={withDeviceSuffix(m.name, m.userId, m.device, deviceCounts)}
                            isGuest={m.isGuest}
                            verified={hasVerifiedBadge(m?.flags)}
                            color={m.nameColor}
                            className={"min-w-0 font-medium text-zinc-700 dark:text-zinc-300"}
                          />
                        )}
                        <span className="shrink-0 text-xs text-zinc-400 tabular-nums dark:text-zinc-600">
                          {formatTime(m.ts)}
                        </span>
                      </div>
                      {onSend && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            startReply(m);
                          }}
                          aria-label={`Responder a ${m.name}`}
                          title="Responder"
                          className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-zinc-400 transition hover:bg-zinc-200/70 hover:text-zinc-800 active:scale-95 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                        >
                          <MdReply className="h-3.5 w-3.5" />
                          <span className="text-[11px] font-medium">Responder</span>
                        </button>
                      )}
                    </div>
                  )}
                  <div className={grouped ? "flex items-start justify-between gap-1.5" : ""}>
                    <div className={grouped ? "min-w-0 flex-1" : ""}>
                      {m.kind === "gif" && m.url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.url} alt="GIF" className="mt-1 max-h-40 max-w-full rounded-md" />
                      ) : (
                        <>
                          {/* Text and pictures are no longer either/or: a message
                              can be a caption with its pictures under it. Empty
                              text draws nothing rather than an empty line. */}
                          {m.text.trim() && (
                            <p className="break-words text-zinc-800 dark:text-zinc-200">
                              {linkifyText(m.text, mentionRegex)}
                            </p>
                          )}
                          {messageImages(m).length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1.5">
                              {messageImages(m).map((url, index) => (
                                // Wrapped in a link because the log shows these
                                // small: the thumbnail is for following the
                                // conversation, the tab is for actually looking
                                // at what was sent.
                                <a
                                  key={`${m.id}-img-${index}`}
                                  href={url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-block"
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={url}
                                    alt="Imagem enviada no chat"
                                    loading="lazy"
                                    className="max-h-56 max-w-full rounded-md border border-zinc-200 transition hover:opacity-90 dark:border-zinc-800"
                                  />
                                </a>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    {grouped && onSend && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          startReply(m);
                        }}
                        aria-label={`Responder a ${m.name}`}
                        title="Responder"
                        className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-zinc-400 transition hover:bg-zinc-200/70 hover:text-zinc-800 active:scale-95 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                      >
                        <MdReply className="h-3.5 w-3.5" />
                        <span className="text-[11px] font-medium">Responder</span>
                      </button>
                    )}
                  </div>
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

      {(blockedMessage || imageError) && (
        <p className="border-t border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-600 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
          {blockedMessage || imageError}
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
          className="relative flex shrink-0 flex-col gap-2 border-t border-zinc-200 p-2 dark:border-zinc-800"
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
                    {peer.isBroadcast ? (
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="font-medium text-zinc-700 dark:text-zinc-300">
                          @{peer.name}
                        </span>
                        <span className="truncate text-[11px] text-zinc-400 dark:text-zinc-500">
                          {peer.description ?? "Mencionar todos"}
                        </span>
                      </div>
                    ) : (
                      <DisplayUserName
                        name={withDeviceSuffix(peer.name, peer.userId, peer.device, deviceCounts)}
                        isGuest={peer.isGuest}
                        verified={hasVerifiedBadge(peer?.flags)}
                        color={peer.nameColor}
                        className="truncate"
                      />
                    )}
                    <span className="shrink-0 text-[10px] text-zinc-400 dark:text-zinc-500 font-mono">
                      Tab ↵
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Discord-style reply banner */}
          {replyingTo && (
            <div className="-mx-2 -mt-2 flex items-center justify-between border-b border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
              <div className="flex min-w-0 items-center gap-1.5">
                <MdReply className="h-4 w-4 shrink-0 text-zinc-400 dark:text-zinc-500" />
                <span className="shrink-0 text-zinc-500 dark:text-zinc-400">
                  Respondendo a{" "}
                  <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                    @{replyingTo.name}
                  </span>
                </span>
                <span className="truncate text-zinc-400 dark:text-zinc-500">
                  {replyingTo.text
                    ? replyingTo.text
                    : replyingTo.kind === "gif"
                      ? "[GIF]"
                      : replyingTo.images?.length
                        ? "[Imagem]"
                        : ""}
                </span>
              </div>
              <Tooltip content="Cancelar resposta (Esc)">
                <button
                  type="button"
                  onClick={cancelReply}
                  aria-label="Cancelar resposta"
                  className="cursor-pointer rounded-md p-1 text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-700 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                >
                  <MdClose className="h-4 w-4" />
                </button>
              </Tooltip>
            </div>
          )}

          {/* The pictures waiting to go, above the input rather than in the
              log: nothing has been sent yet, and a message that is a caption
              plus its pictures has to be composable as one thing. */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {attachments.map((attachment) => (
                <div
                  key={attachment.id}
                  className="relative h-16 w-16 overflow-hidden rounded-lg border border-zinc-300 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900"
                >
                  {attachment.dataUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={attachment.dataUrl}
                      alt={attachment.name || "Imagem anexada"}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center">
                      <span
                        aria-hidden
                        className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-400 border-t-transparent"
                      />
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => removeAttachment(attachment.id)}
                    disabled={sendingImages}
                    aria-label={`Remover ${attachment.name || "imagem"}`}
                    className="absolute right-0.5 top-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-zinc-950/70 text-xs text-white transition hover:bg-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <MdClose aria-hidden />
                  </button>
                </div>
              ))}
              {/* Says how much room is left without needing a second look at
                  the tray, and is the only place the limit is stated. */}
              <span className="self-end pb-1 text-[11px] text-zinc-400 dark:text-zinc-600">
                {attachments.length}/{CHAT_IMAGE_MAX_PER_MESSAGE}
              </span>
            </div>
          )}
          <div className="flex items-end gap-2">
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
                  onClick={onSendGif ? () => setPickerOpen((open) => !open) : onRequestAccount}
                  aria-label="Adicionar GIF"
                  className={`inline-flex h-8 shrink-0 items-center justify-center rounded-lg border px-2.5 text-xs font-semibold transition ${
                    onSendGif
                      ? "border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      : "border-zinc-200 opacity-50 text-zinc-400 dark:border-zinc-800 dark:text-zinc-600"
                  }`}
                >
                  GIF
                </button>
              </span>
            </Popover>
            {/* Off-screen rather than absent: a file input is the only way to
                open the system picker, and it has to survive between clicks. */}
            <input
              ref={fileInputRef}
              type="file"
              accept={CHAT_IMAGE_ACCEPT}
              multiple
              onChange={handleFileChange}
              className="hidden"
            />
            <Tooltip
              content={
                !onSendImages
                  ? (imageDisabledReason ?? "Utilize uma conta para enviar imagens")
                  : trayFull
                    ? `Máximo de ${CHAT_IMAGE_MAX_PER_MESSAGE} imagens por mensagem`
                    : "Anexar imagem (ou cole com Ctrl+V)"
              }
            >
              <span className="inline-flex shrink-0">
                <button
                  type="button"
                  onClick={
                    !onSendImages
                      ? onRequestAccount
                      : canAttach
                        ? () => fileInputRef.current?.click()
                        : undefined
                  }
                  aria-label="Anexar imagem"
                  className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-base transition ${
                    canAttach
                      ? "border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      : "border-zinc-200 opacity-50 text-zinc-400 dark:border-zinc-800 dark:text-zinc-600"
                  }`}
                >
                  <MdOutlineImage aria-hidden />
                </button>
              </span>
            </Tooltip>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              onKeyUp={handleKeyUp}
              onClick={handleClick}
              onInput={handleInput}
              onPaste={handlePaste}
              maxLength={500}
              rows={1}
              disabled={Boolean(sendDisabledReason) || sendingImages}
              placeholder={
                sendDisabledReason ??
                (replyingTo
                  ? `Responder a @${replyingTo.name}...`
                  : attachments.length > 0
                    ? "Escreva algo junto (opcional)..."
                    : "Digite uma mensagem...")
              }
              className="min-h-8 min-w-0 flex-1 resize-none rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-base sm:text-sm leading-5 text-zinc-950 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-950/10 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:ring-white/10"
            />
            <button
              type="submit"
              disabled={!canSend}
              aria-label="Enviar"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-950 text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              {sendingImages ? (
                <span
                  aria-hidden
                  className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
                />
              ) : (
                <MdSend className="h-4 w-4" />
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

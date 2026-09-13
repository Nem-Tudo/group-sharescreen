"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type RefObject,
} from "react";
import {
  ensureEmojiIndex,
  getEmojiIndex,
  getEmojiTrigger,
  replaceShortcodes,
  searchEmoji,
  subscribeEmojiIndex,
  type EmojiIndex,
  type EmojiMatch,
  type EmojiTrigger,
} from "@/lib/emoji";

// The emoji half of a chat composer: ":" opens a list of emoji by name,
// ":sob:" typed out in full becomes 😭, and the picker's choice lands where the
// cursor is. Shared by the three composers (the room chat, DMs and groups),
// which differ in everything else — how they hold their text, how they grow,
// what they announce while somebody types — so this owns none of that. It
// reads the textarea through the ref and hands every change back through
// `onReplace`, and the composer applies it however it applies its own.

const NO_MATCHES: EmojiMatch[] = [];
const SUGGESTIONS = 8;

/** The emoji index for the site's language, or null until it has loaded. */
export function useEmojiIndex(): EmojiIndex | null {
  return useSyncExternalStore(subscribeEmojiIndex, getEmojiIndex, () => null);
}

export function useEmojiAutocomplete({
  textareaRef,
  onReplace,
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** Puts `text` in the box with the cursor at `caret`. */
  onReplace: (text: string, caret: number) => void;
}) {
  const index = useEmojiIndex();
  const [trigger, setTrigger] = useState<EmojiTrigger | null>(null);
  const [highlight, setHighlight] = useState(0);
  // Whether the arrows have been used on this list. Enter only picks from a
  // list somebody has looked at, or once two letters have been typed —
  // otherwise ":D" and Enter would send a 😁 nobody chose instead of ":D".
  const [navigated, setNavigated] = useState(false);
  // The ":" whose list Escape closed. Keyed by position, so the list stays
  // shut while that name is being typed and opens again for the next ":".
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

  const onReplaceRef = useRef(onReplace);
  useEffect(() => {
    onReplaceRef.current = onReplace;
  }, [onReplace]);

  const matches = useMemo(
    () => (trigger && index ? searchEmoji(index, trigger.query, SUGGESTIONS) : NO_MATCHES),
    [trigger, index]
  );
  const open = trigger !== null && matches.length > 0 && dismissedAt !== trigger.start;
  const selected = Math.min(highlight, Math.max(matches.length - 1, 0));

  /** Puts the cursor back in the box after React has re-rendered it. */
  const placeCaret = useCallback(
    (caret: number) => {
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(caret, caret);
      });
    },
    [textareaRef]
  );

  // Only a trigger that actually changed resets the list: onKeyUp follows
  // every arrow press with a sync, and resetting there would undo the arrow.
  function track(text: string, caret: number) {
    const next = getEmojiTrigger(text, caret);
    if (trigger?.start === next?.start && trigger?.query === next?.query) return;
    setTrigger(next);
    setHighlight(0);
    setNavigated(false);
  }

  /**
   * For the composer's onChange: what the box should now hold, and where the
   * cursor is in it. Any ":name:" just finished is already the emoji.
   */
  function handleChange(value: string, caret: number): { text: string; caret: number } {
    if (value.includes(":")) ensureEmojiIndex();
    let text = value;
    let at = caret;
    if (index) {
      const replaced = replaceShortcodes(value, caret, index);
      if (replaced.text !== value) {
        text = replaced.text;
        at = replaced.caret;
        placeCaret(at);
      }
    }
    track(text, at);
    return { text, caret: at };
  }

  /** For onKeyUp, onClick and onSelect: the cursor moved without typing. */
  function sync() {
    const el = textareaRef.current;
    if (el) track(el.value, el.selectionStart ?? el.value.length);
  }

  /** Swaps the ":name" being typed for the chosen emoji. */
  function pick(match: EmojiMatch) {
    const el = textareaRef.current;
    if (!el || !trigger) return;
    const value = el.value;
    const caret = el.selectionStart ?? value.length;
    const after = value.slice(caret);
    // A space after it, as Discord does, so the next word does not start
    // glued to the emoji — unless there already is one.
    const spacer = /^\s/.test(after) ? "" : " ";
    const text = value.slice(0, trigger.start) + match.entry.unicode + spacer + after;
    const at = trigger.start + match.entry.unicode.length + spacer.length;
    onReplaceRef.current(text, at);
    setTrigger(null);
    placeCaret(at);
  }

  /** Drops an emoji at the cursor — over the selection, if there is one. */
  function insert(emoji: string) {
    const el = textareaRef.current;
    if (!el) return;
    const value = el.value;
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? start;
    const text = value.slice(0, start) + emoji + value.slice(end);
    const at = start + emoji.length;
    onReplaceRef.current(text, at);
    setTrigger(null);
    placeCaret(at);
  }

  /**
   * For the composer's onKeyDown, called first. True when the key was the
   * list's — the composer must then do nothing else with it (Enter picks here
   * rather than sending).
   */
  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): boolean {
    if (!open || !trigger) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setNavigated(true);
      setHighlight((selected + step + matches.length) % matches.length);
      return true;
    }
    const enterPicks =
      e.key === "Enter" &&
      !e.shiftKey &&
      !e.nativeEvent.isComposing &&
      (navigated || trigger.query.length >= 2);
    if (e.key === "Tab" || enterPicks) {
      e.preventDefault();
      pick(matches[selected]);
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      // Closing the list, not the dialog the composer happens to sit in.
      e.stopPropagation();
      setDismissedAt(trigger.start);
      return true;
    }
    return false;
  }

  /**
   * For sending: every ":name:" still in the text becomes its emoji — one
   * pasted in, or typed before the names had finished loading.
   */
  function convert(text: string): string {
    return index ? replaceShortcodes(text, text.length, index).text : text;
  }

  // The names can arrive after somebody has already typed ":sob:" — the very
  // first time, on a slow connection. The box catches up when they do.
  useEffect(() => {
    if (!index) return;
    const el = textareaRef.current;
    if (!el || !el.value.includes(":")) return;
    const replaced = replaceShortcodes(el.value, el.selectionStart ?? el.value.length, index);
    if (replaced.text === el.value) return;
    onReplaceRef.current(replaced.text, replaced.caret);
    placeCaret(replaced.caret);
  }, [index, textareaRef, placeCaret]);

  return {
    open,
    matches,
    highlight: selected,
    setHighlight,
    pick,
    insert,
    handleChange,
    handleKeyDown,
    sync,
    convert,
    /** Starts loading the names early — on focus, say — so ":" is instant. */
    prefetch: ensureEmojiIndex,
  };
}

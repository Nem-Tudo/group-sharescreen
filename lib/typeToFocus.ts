"use client";

import { useEffect, type RefObject } from "react";

// Typing goes to the message box: with the focus anywhere else around a
// conversation — after clicking a message, a person, a button — a key that
// types something moves the focus to the box, cursor at the end, and the key
// lands in it. Shared by a group's text room (GroupMessageComposer) and the
// private messages (DirectMessagesModal), so both behave the same.
//
// Focusing during keydown is enough: the character is inserted into whatever
// holds the focus once keydown is over, so nothing is re-typed by hand. A dead
// key (the ´ of "é") and a paste move the focus the same way, so the accent
// and the pasted text land here too.

// Where a key pressed with nothing in particular focused may be taken over by
// the box. Whatever has the focus, or is open on top, gets its keys first:
//
//   - a field of any kind already takes typing — this box included;
//   - a menu, list or dialog that has the focus reads letters as its own
//     (type-ahead, shortcuts), and space presses whatever button is focused;
//   - a dialog, menu or panel open anywhere (a picker, a sheet, a profile)
//     means the person is busy with that, not with this conversation;
//   - and the box has to actually be on screen and uncovered: a backdrop over
//     it is a modal this list does not know by name.
//
// A dialog the box itself sits in is not "something else": the private
// messages are a dialog of their own, and the box inside it is exactly where
// its typing belongs. So any container below that holds the box is skipped.
const KEYS_OF_THEIR_OWN =
  '[role="menu"], [role="menubar"], [role="listbox"], [role="tree"], [role="grid"], [role="slider"], [role="tablist"], [role="radiogroup"], [role="dialog"]';
const OPEN_ON_TOP =
  '[aria-modal="true"], [role="menu"], .tippy-box[data-theme~="golive-panel"]:not([data-state="hidden"])';

export function canTakeOverTyping(box: HTMLTextAreaElement, key: string): boolean {
  const active = document.activeElement as HTMLElement | null;
  if (active && active !== document.body && active !== document.documentElement) {
    if (active.isContentEditable || active.matches("input, textarea, select")) return false;
    if (key === " ") return false;
    const owner = active.closest(KEYS_OF_THEIR_OWN);
    if (owner && !owner.contains(box)) return false;
  }
  for (const layer of document.querySelectorAll(OPEN_ON_TOP)) {
    if (!layer.contains(box)) return false;
  }
  const rect = box.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  const composer = box.closest("[data-composer]") ?? box;
  return Boolean(hit && composer.contains(hit));
}

/**
 * Sends typing to `boxRef`'s box whenever nothing else wants the key — see
 * canTakeOverTyping.
 *
 * The focus moves last, from a listener added to `window` while the key is
 * still on its way up — one added mid-dispatch runs after those already there.
 * That is where the call shortcuts listen (lib/keyboardShortcuts), and a
 * one-letter shortcut that took the key cancels it: the box then leaves the
 * focus where it was instead of grabbing it for a letter that never arrives.
 */
export function useTypeToFocus(boxRef: RefObject<HTMLTextAreaElement | null>, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(e: KeyboardEvent) {
      const el = boxRef.current;
      if (!el || el.disabled || e.defaultPrevented || e.isComposing) return;
      // AltGr arrives as Ctrl+Alt on Windows, and types characters.
      const altGraph = e.getModifierState?.("AltGraph") ?? false;
      const paste = (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "v";
      if (!paste) {
        if (!altGraph && (e.ctrlKey || e.metaKey || e.altKey)) return;
        if (e.key.length !== 1 && e.key !== "Dead") return;
      }
      if (!canTakeOverTyping(el, e.key)) return;
      window.addEventListener(
        "keydown",
        (late) => {
          if (late !== e || e.defaultPrevented || boxRef.current !== el || el.disabled) return;
          el.focus({ preventScroll: true });
          el.setSelectionRange(el.value.length, el.value.length);
        },
        { once: true }
      );
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [boxRef, enabled]);
}

"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type ReactNode,
  type Ref,
} from "react";
import { tokenizeMentions } from "@/lib/chatMentions";

// A textarea whose valid @mentions are already blue while they are typed.
//
// A textarea can only paint its text in one colour, so the colour comes from
// a mirror: a box laid exactly over the textarea, with the same classes — the
// same padding, border width, font and line height — holding the same text,
// with the mentions wrapped in coloured spans. The textarea stays underneath
// and keeps doing everything a textarea does (typing, the caret, selection,
// the IME, paste, autofill); only its text is made transparent, so what is
// read is the mirror's copy.
//
// Everything hangs on the two boxes wrapping the text at the same places, so
// the mirror only draws colour and never weight or size (a bold mention would
// be wider than the letters under it and drag the caret out of line). And the
// mirror only exists while there is a mention to colour: text with none is the
// plain textarea it always was.

/** How a mention looks in the box — the colour messages draw them in. */
const MENTION_CLASS = "rounded-sm bg-blue-500/15 text-blue-600 dark:text-blue-400";

/**
 * `text` split into spans, with every match of any of `regexes` coloured, or
 * null when nothing matched. The regexes are tried in order, each on what the
 * ones before it left as plain text ("@" people first, then "#" rooms).
 */
export function highlightMentions(text: string, regexes: (RegExp | null)[]): ReactNode[] | null {
  let parts: ({ text: string } | { mention: string })[] = [{ text }];
  for (const regex of regexes) {
    if (!regex) continue;
    parts = parts.flatMap((part) =>
      "text" in part
        ? tokenizeMentions(part.text, regex).map((token) =>
            token.type === "mention" ? { mention: token.value } : { text: token.value }
          )
        : [part]
    );
  }
  if (!parts.some((part) => "mention" in part)) return null;
  return parts.map((part, index) =>
    "mention" in part ? (
      <span key={index} className={MENTION_CLASS}>
        {part.mention}
      </span>
    ) : (
      part.text
    )
  );
}

export function HighlightedTextarea({
  value,
  highlights,
  wrapperClassName = "",
  className = "",
  ref,
  onScroll,
  ...props
}: Omit<ComponentProps<"textarea">, "value"> & {
  value: string;
  /** The mirror's content — see highlightMentions. Null for plain text. */
  highlights: ReactNode[] | null;
  /** The layout classes the textarea had in its row (flex-1, min-w-0…). */
  wrapperClassName?: string;
  ref?: Ref<HTMLTextAreaElement>;
}) {
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const mirrorRef = useRef<HTMLDivElement | null>(null);
  const active = Boolean(value && highlights);

  // One identity for the life of the component: a new callback each render
  // would hand the composer's ref null and then the node again on every
  // keystroke.
  const setRefs = useCallback(
    (node: HTMLTextAreaElement | null) => {
      textRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref]
  );

  /**
   * Keeps the mirror scrolled with the textarea, and as narrow: a textarea
   * that has grown a scrollbar wraps its text in less width, and the mirror
   * (which never shows one) has to give up the same strip.
   */
  const sync = useCallback(() => {
    const el = textRef.current;
    const mirror = mirrorRef.current;
    if (!el || !mirror) return;
    const style = getComputedStyle(el);
    const borders = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
    const scrollbar = Math.max(0, el.offsetWidth - el.clientWidth - borders);
    mirror.style.paddingRight = `${parseFloat(style.paddingRight) + scrollbar}px`;
    mirror.scrollTop = el.scrollTop;
  }, []);

  useLayoutEffect(() => {
    if (active) sync();
  });

  // The composers grow the box themselves, outside React (see their resize
  // functions) — a height change is not a render, so it is watched here.
  useEffect(() => {
    const el = textRef.current;
    if (!active || !el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => sync());
    observer.observe(el);
    return () => observer.disconnect();
  }, [active, sync]);

  return (
    <div className={`relative ${wrapperClassName}`}>
      <textarea
        {...props}
        ref={setRefs}
        value={value}
        onScroll={(event) => {
          sync();
          onScroll?.(event);
        }}
        className={`${className} block w-full`}
        style={
          active
            ? // The caret would go transparent with the text; it is given the
              // page's text colour back explicitly.
              { ...props.style, color: "transparent", caretColor: "var(--foreground)" }
            : props.style
        }
      />
      {active && (
        <div
          ref={mirrorRef}
          aria-hidden
          className={`${className} pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words`}
          style={{ background: "transparent", borderColor: "transparent", boxShadow: "none" }}
        >
          {highlights}
          {/* A last line the textarea has after a trailing newline, and an
              empty div would not. */}
          {"\u200b"}
        </div>
      )}
    </div>
  );
}

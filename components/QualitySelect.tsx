"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { MdExpandMore } from "react-icons/md";
import { DEFAULT_PLAN_ICON_ID, PLAN_ICONS } from "@/components/planIcons";
import { hasFeature, lockLabel, lockName, lockTier, type Feature } from "@/lib/entitlements";
import { FINE_POINTER_QUERY, useMediaQuery } from "@/lib/useMediaQuery";

// One of the room's quality dials, in whichever form the machine deserves.
//
// Two implementations of one control, and the split is not cosmetic:
//
//   - **with a mouse**, a custom listbox. It exists for one reason — a native
//     <option> may contain text and nothing else, so the Pro badge beside a
//     locked option could only ever be a character there. Here it is the real
//     mark, the same component the /pro page and the header draw.
//   - **on touch**, the native <select>, which opens the operating system's
//     own picker: a full-width wheel or sheet, sized for a thumb, that no
//     hand-written dropdown in a live room is going to beat. That one keeps
//     the text glyph, because that is all it can have.
//
// The choice is made on `(pointer: fine)` rather than a width, because the
// question is "is there a mouse", not "is the window narrow" — a half-screen
// desktop browser is still a desktop, and a landscape tablet is still touch.
// useMediaQuery reports false until the first client paint, so the native one
// renders first; that is the right way round, since it is the one that works
// without JavaScript having decided anything.

const MARK = PLAN_ICONS[DEFAULT_PLAN_ICON_ID];

/** Tallest the list ever gets, before the viewport gets a say. */
const MAX_LIST_HEIGHT = 224;
/** Below this there is no point opening downward at all. */
const MIN_LIST_HEIGHT = 96;
/** Breathing room kept between the list and the edge of the window. */
const VIEWPORT_GAP = 8;

export interface QualityOption<T> {
  value: T;
  label: string;
  /** Set when the option is gated; see lib/entitlements.ts. */
  feature?: Feature;
}

export function QualitySelect<T extends string | number>({
  label,
  value,
  options,
  features,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly QualityOption<T>[];
  features: readonly string[];
  onChange: (value: T) => void;
}) {
  const fine = useMediaQuery(FINE_POINTER_QUERY);
  const reactId = useId();
  const controlId = `quality-${reactId}`;
  const labelId = `${controlId}-label`;

  const [open, setOpen] = useState(false);
  // Which option the keyboard is on, which is not the same as which is
  // selected: arrowing through a list without committing is the whole point
  // of having one.
  const [activeIndex, setActiveIndex] = useState(-1);
  // Which way the list opens, and how tall it may be. Measured rather than
  // assumed: this control sits at the bottom of a panel that is itself
  // anchored to a button in the room's bottom bar, so on a short screen there
  // is routinely no room below it at all.
  const [drop, setDrop] = useState({ up: false, maxHeight: MAX_LIST_HEIGHT });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;
  const enabled = useCallback(
    (option: QualityOption<T>) => hasFeature(option.feature, features),
    [features]
  );

  // Run from the click and from resize/scroll while open — never from an
  // effect body, which would be a setState during render's commit.
  const measure = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const below = window.innerHeight - rect.bottom - VIEWPORT_GAP;
    const above = rect.top - VIEWPORT_GAP;
    // Upward only when it genuinely helps: a list that flips to a side with
    // even less room has moved for nothing and now covers the label too.
    const up = below < MIN_LIST_HEIGHT && above > below;
    const room = up ? above : below;
    setDrop({ up, maxHeight: Math.max(MIN_LIST_HEIGHT, Math.min(MAX_LIST_HEIGHT, room)) });
  }, []);

  useEffect(() => {
    if (!open) return;
    // Capture phase, because the thing that moves this button is usually an
    // ancestor scrolling, and a scroll event on an element does not bubble.
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, measure]);

  const openList = useCallback(() => {
    // Lands on the current value when it is still reachable, and on the first
    // thing that is otherwise — which is what happens to somebody whose
    // subscription lapsed while a 4K option was selected.
    const start = selectedIndex >= 0 && enabled(options[selectedIndex]!)
      ? selectedIndex
      : options.findIndex(enabled);
    measure();
    setActiveIndex(start);
    setOpen(true);
  }, [enabled, measure, options, selectedIndex]);

  const closeList = useCallback((focusButton: boolean) => {
    setOpen(false);
    if (focusButton) buttonRef.current?.focus();
  }, []);

  // Pointer down rather than click: a click that starts inside the list and
  // ends outside it should not count as leaving, and pointerdown is also what
  // fires before the browser moves focus.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Keeps the keyboard's position on screen in a list tall enough to scroll.
  //
  // Scrolled by hand rather than with scrollIntoView, which was the bug: that
  // one walks up and scrolls *every* scrollable ancestor it needs to, so
  // opening this near the bottom of a short window yanked the whole room
  // upward to bring an option into view. This can only ever move the list.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const list = listRef.current;
    const node = list?.children[activeIndex] as HTMLElement | undefined;
    if (!list || !node) return;
    const top = node.offsetTop;
    const bottom = top + node.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = bottom - list.clientHeight;
    }
  }, [open, activeIndex]);

  useEffect(() => {
    if (open) listRef.current?.focus();
  }, [open]);

  /** The next selectable option in `step`'s direction, or the current one. */
  const move = useCallback(
    (from: number, step: number) => {
      for (let i = from + step; i >= 0 && i < options.length; i += step) {
        if (enabled(options[i]!)) return i;
      }
      return from;
    },
    [enabled, options]
  );

  function commit(index: number) {
    const option = options[index];
    if (!option || !enabled(option)) return;
    onChange(option.value);
    closeList(true);
  }

  function onListKeyDown(event: React.KeyboardEvent) {
    // Stopped before it reaches the document: the panel this control sits in
    // closes on Escape (see Tooltip.tsx's Popover), and Escape here means
    // "close the dropdown", not "throw away the settings panel".
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        closeList(true);
        return;
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((current) => move(current, 1));
        return;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((current) => move(current, -1));
        return;
      case "Home":
        event.preventDefault();
        setActiveIndex(move(-1, 1));
        return;
      case "End":
        event.preventDefault();
        setActiveIndex(move(options.length, -1));
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        commit(activeIndex);
        return;
      case "Tab":
        // Left rather than trapped: a dropdown that swallows Tab is a
        // keyboard dead end in a panel with several more fields after it.
        closeList(false);
        return;
      default:
    }
  }

  if (!fine) {
    return (
      <div>
        <label
          htmlFor={controlId}
          className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
        >
          {label}
        </label>
        <select
          id={controlId}
          value={String(value)}
          onChange={(event) => {
            // Matched back through the option list because a <select> only
            // ever hands back a string, and half of these dials are numbers.
            const option = options.find((candidate) => String(candidate.value) === event.target.value);
            if (option) onChange(option.value);
          }}
          className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        >
          {options.map((option) => (
            <option
              key={String(option.value)}
              value={String(option.value)}
              disabled={!enabled(option)}
            >
              {option.label}
              {lockLabel(option.feature, features) ?? ""}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <span
        id={labelId}
        className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
      >
        {label}
      </span>
      <button
        ref={buttonRef}
        type="button"
        id={controlId}
        role="combobox"
        aria-controls={`${controlId}-list`}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-labelledby={`${labelId} ${controlId}`}
        onClick={() => (open ? closeList(false) : openList())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openList();
          }
        }}
        className="flex w-full items-center gap-1.5 rounded-md border border-zinc-300 px-3 py-1.5 text-left text-sm text-zinc-950 outline-none transition focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
      >
        {/* Only when the *selected* value is itself locked, which happens to
            somebody whose subscription lapsed with 4K still chosen. */}
        {selected && !enabled(selected) && (
          <MARK.Icon className={`h-4 w-4 shrink-0 ${MARK.className}`} />
        )}
        <span className="flex-1 truncate">{selected?.label ?? String(value)}</span>
        <MdExpandMore
          aria-hidden
          className={`h-4 w-4 shrink-0 text-zinc-500 transition ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <ul
          ref={listRef}
          id={`${controlId}-list`}
          role="listbox"
          tabIndex={-1}
          aria-labelledby={labelId}
          aria-activedescendant={activeIndex >= 0 ? `${controlId}-opt-${activeIndex}` : undefined}
          onKeyDown={onListKeyDown}
          // z-50 and absolute: the panel this lives in is itself a popover,
          // and nothing between here and it clips (see globals.css's
          // golive-panel theme, which sets no overflow).
          style={{ maxHeight: drop.maxHeight }}
          className={`absolute z-50 w-full overflow-y-auto rounded-md border border-zinc-300 bg-white py-1 shadow-lg outline-none dark:border-zinc-700 dark:bg-zinc-900 ${
            drop.up ? "bottom-full mb-1" : "top-full mt-1"
          }`}
        >
          {options.map((option, index) => {
            const locked = !enabled(option);
            const tier = lockTier(option.feature, features);
            const isSelected = option.value === value;
            return (
              <li
                key={String(option.value)}
                id={`${controlId}-opt-${index}`}
                role="option"
                aria-selected={isSelected}
                aria-disabled={locked}
                // Mouse down rather than click, so the list does not lose
                // focus to the browser before the choice is registered.
                onMouseDown={(event) => {
                  event.preventDefault();
                  commit(index);
                }}
                onMouseEnter={() => !locked && setActiveIndex(index)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm ${
                  locked
                    ? "cursor-not-allowed text-zinc-400 dark:text-zinc-600"
                    : "cursor-pointer text-zinc-950 dark:text-zinc-50"
                } ${index === activeIndex && !locked ? "bg-zinc-100 dark:bg-zinc-800" : ""}`}
              >
                <span className="flex-1 truncate">{option.label}</span>
                {/* The whole reason this control exists: the real badge, not
                    the text glyph a native <option> would force. It follows
                    the word rather than leading the row, so the three things
                    read in one order — what the option is, what it costs, and
                    the mark that names the plan. */}
                {tier === "premium" ? (
                  <a
                    href="/pro"
                    // A new tab, and this is not a preference: this dropdown
                    // only exists inside a room, so following the link in
                    // place would tear down a live call to go read a price.
                    // It also lands correctly in the desktop shell, where
                    // setWindowOpenHandler sends it to the system browser
                    // while will-navigate would have replaced the app.
                    target="_blank"
                    rel="noopener noreferrer"
                    // The row's own mousedown selects; this one must not reach
                    // it. (It would be refused anyway — commit() ignores a
                    // locked option — but relying on that would make this
                    // break the day locked rows become selectable.)
                    onMouseDown={(event) => event.stopPropagation()}
                    // Not a tab stop: Tab closes the list (see
                    // onListKeyDown), so a focusable link in here would be a
                    // stop nobody can reach. /pro is one click away in the
                    // header on every page, which is the keyboard route.
                    tabIndex={-1}
                    className="flex shrink-0 items-center gap-1 rounded px-1 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                  >
                    <MARK.Icon
                      className={`h-4 w-4 shrink-0 ${MARK.className}`}
                      aria-label={MARK.label}
                    />
                    Pro
                  </a>
                ) : (
                  locked && (
                    <span className="shrink-0 text-xs text-zinc-400 dark:text-zinc-600">
                      {lockName(option.feature, features)}
                    </span>
                  )
                )}
                {isSelected && !locked && (
                  <span aria-hidden className="shrink-0 text-xs text-zinc-400">
                    ✓
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

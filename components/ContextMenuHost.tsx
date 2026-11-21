"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import Tippy from "@tippyjs/react";
import {
  MdCheck,
  MdContentCopy,
  MdContentCut,
  MdContentPaste,
  MdImage,
  MdLink,
  MdOpenInNew,
  MdSelectAll,
} from "react-icons/md";
import { MobileSheet } from "@/components/MobileSheet";
import { copyImageOrLink, copyText } from "@/lib/clipboard";
import { isTouchPointer, useCoarsePointer } from "@/lib/messageGestures";
import {
  closeContextMenu,
  openContextMenu,
  useContextMenu,
  type ContextMenuEntries,
  type ContextMenuEntry,
} from "@/lib/contextMenu";
import { translate } from "@/lib/i18n";

// The one right-click menu of the page — see lib/contextMenu. Mounted once at
// the root, drawn at the pointer, and closed by a click anywhere else (the
// right button included, which is how opening another one replaces it),
// Escape, scrolling, or the window losing focus.
//
// On a touch screen the same menu is an action sheet from the bottom instead
// (a long press opens it — see lib/messageGestures): a 220px panel of 32px
// rows under the finger that just pressed is half hidden by that finger and
// hard to hit, where a sheet is in reach of the thumb, with rows a finger can
// land on, and closes the way every other sheet does (drag down, tap outside,
// Android's back).

const item =
  "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm outline-none transition disabled:cursor-default disabled:opacity-40";
const itemTone =
  "text-zinc-700 hover:bg-zinc-100 focus-visible:bg-zinc-100 disabled:hover:bg-transparent dark:text-zinc-200 dark:hover:bg-zinc-900 dark:focus-visible:bg-zinc-900";
const dangerTone =
  "text-red-600 hover:bg-red-500/10 focus-visible:bg-red-500/10 disabled:hover:bg-transparent dark:text-red-400";
/** A row of the sheet: 48px, the thumb's size, with the press shown as it lands. */
const sheetItem =
  "flex min-h-12 w-full cursor-pointer items-center gap-3.5 rounded-xl px-3 py-2.5 text-left text-[15px] font-medium outline-none transition disabled:cursor-default disabled:opacity-40 focus-visible:bg-zinc-100 dark:focus-visible:bg-zinc-900";
const sheetTone = "text-zinc-800 active:bg-zinc-100 dark:text-zinc-100 dark:active:bg-zinc-900";
const sheetDangerTone = "text-red-600 active:bg-red-500/10 dark:text-red-400";

export function ContextMenuHost() {
  const menu = useContextMenu();
  const touch = useCoarsePointer();
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Everything that moves the page from under the menu takes it away. Not
  // the sheet's: it covers the page, so nothing moves under it — and a phone
  // resizes the window when its keyboard comes up (the emoji search in the
  // reaction sheet), which must not shut the sheet being typed into.
  useEffect(() => {
    if (!menu || touch) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") closeContextMenu();
    };
    const onScroll = (event: Event) => {
      if (panelRef.current && event.target instanceof Node && panelRef.current.contains(event.target)) return;
      closeContextMenu();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("blur", closeContextMenu);
    window.addEventListener("resize", closeContextMenu);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("blur", closeContextMenu);
      window.removeEventListener("resize", closeContextMenu);
    };
  }, [menu, touch]);

  // Up and down walk the entries, as in any menu.
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const buttons = [...(panelRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    if (buttons.length === 0) return;
    event.preventDefault();
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? (at + 1) % buttons.length : (at - 1 + buttons.length) % buttons.length;
    buttons[at < 0 ? 0 : next].focus();
  }

  if (touch) {
    return (
      <MobileSheet
        open={Boolean(menu)}
        onClose={closeContextMenu}
        title={menu?.title}
        label={translate("contextMenu.options")}
        // Over a popup too: the menu of a member inside the group's settings.
        layerClassName="z-[70]"
      >
        {menu && (
          <div key={menu.seq} role="menu" onContextMenu={(e) => e.preventDefault()} className="flex select-none flex-col pb-1">
            {menu.entries.map((entry, index) => (
              <Entry key={index} entry={entry} sheet />
            ))}
          </div>
        )}
      </MobileSheet>
    );
  }

  return (
    <>
      <span ref={setAnchor} aria-hidden className="pointer-events-none fixed left-0 top-0 h-0 w-0" />
      {anchor && (
        <Tippy
          reference={anchor}
          visible={Boolean(menu)}
          getReferenceClientRect={() => new DOMRect(menu?.x ?? 0, menu?.y ?? 0, 0, 0)}
          onClickOutside={closeContextMenu}
          interactive
          placement="right-start"
          offset={[0, 4]}
          theme="golive-panel"
          animation="shift-away"
          duration={[120, 80]}
          maxWidth="none"
          appendTo={() => document.body}
          // Flipped and shifted rather than cut off at the screen's edge.
          popperOptions={{ modifiers: [{ name: "flip", options: { fallbackPlacements: ["left-start", "right-end", "left-end"] } }] }}
          content={
            menu ? (
              <div
                key={menu.seq}
                ref={panelRef}
                role="menu"
                onKeyDown={onKeyDown}
                // A press on an entry must not take the focus (or the text
                // selection) from where the menu was opened — cutting and
                // pasting into a text box depend on it.
                onMouseDown={(e) => e.preventDefault()}
                onContextMenu={(e) => e.preventDefault()}
                className="flex max-h-[80vh] w-56 select-none flex-col gap-0.5 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
              >
                {menu.title && (
                  <div className="truncate px-2 pb-1 pt-0.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                    {menu.title}
                  </div>
                )}
                {menu.entries.map((entry, index) => (
                  <Entry key={index} entry={entry} />
                ))}
              </div>
            ) : null
          }
        />
      )}
    </>
  );
}

function Entry({ entry, sheet = false }: { entry: ContextMenuEntry; sheet?: boolean }) {
  if (entry.type === "divider") {
    return <div role="separator" className={`border-t border-zinc-200 dark:border-zinc-800 ${sheet ? "mx-3 my-1.5" : "my-1"}`} />;
  }
  if (entry.type === "label") {
    return (
      <p className="px-2 pb-0.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {entry.label}
      </p>
    );
  }
  if (entry.type === "custom") return <>{entry.render(closeContextMenu)}</>;
  return (
    <button
      type="button"
      role={entry.checked === undefined ? "menuitem" : "menuitemcheckbox"}
      aria-checked={entry.checked}
      disabled={entry.disabled}
      onClick={() => {
        if (!entry.keepOpen) closeContextMenu();
        entry.onSelect();
      }}
      className={sheet ? `${sheetItem} ${entry.danger ? sheetDangerTone : sheetTone}` : `${item} ${entry.danger ? dangerTone : itemTone}`}
    >
      {/* The icons are drawn at 16px by every caller; the sheet scales them
          up to 20 rather than asking each menu for a second size. */}
      <span
        className={`flex shrink-0 items-center justify-center ${
          sheet ? "h-5 w-5 [&>svg]:!h-5 [&>svg]:!w-5" : "h-4 w-4"
        } ${entry.danger ? "" : "opacity-70"}`}
      >
        {entry.icon}
      </span>
      <span className={`min-w-0 flex-1 ${sheet ? "" : "truncate"}`}>{entry.label}</span>
      {entry.hint && !sheet && <kbd className="shrink-0 font-sans text-[10px] text-zinc-400">{entry.hint}</kbd>}
      {entry.checked && <MdCheck className={`shrink-0 text-emerald-600 ${sheet ? "h-5 w-5" : "h-4 w-4"}`} />}
    </button>
  );
}

// ─── Instead of the browser's menu ────────────────────────────────────────
//
// Where a page asks for it (the groups, see GroupAppShell), the browser's own
// right-click menu never opens: every right button goes to ours. The things
// on the page that declare a menu already have one; for the rest this stands
// in with what the browser's menu was actually used for there — cutting,
// copying and pasting in a text box, copying a selection, a link, a picture —
// so nothing that worked before stops working. Anywhere else, nothing opens.

const TEXT_INPUT_TYPES = new Set(["text", "search", "url", "email", "tel", "password", "number", ""]);

function fallbackEntries(event: MouseEvent): ContextMenuEntries {
  const target = event.target instanceof Element ? event.target : null;
  const icon = "h-4 w-4";

  const field = target?.closest("input, textarea") as HTMLInputElement | HTMLTextAreaElement | null;
  if (field && (field instanceof HTMLTextAreaElement || TEXT_INPUT_TYPES.has(field.type))) {
    // Read now: the press on the menu keeps the focus where it is (see the
    // panel's onMouseDown), but the numbers are what the action restores.
    let start = 0;
    let end = 0;
    try {
      start = field.selectionStart ?? 0;
      end = field.selectionEnd ?? 0;
    } catch {
      // A number input has no selection to read.
    }
    const selected = field.value.slice(start, end);
    const editable = !field.readOnly && !field.disabled;
    const secret = field instanceof HTMLInputElement && field.type === "password";
    const restore = () => {
      field.focus();
      try {
        field.setSelectionRange(start, end);
      } catch {
        // As above.
      }
    };
    return [
      {
        label: translate("contextMenu.cut"),
        icon: <MdContentCut className={icon} />,
        disabled: !selected || !editable || secret,
        onSelect: () => {
          void copyText(selected);
          restore();
          // Through the editing command rather than by setting the value, so
          // the field's own change handlers (React's included) hear about it
          // and it can be undone.
          document.execCommand("delete");
        },
      },
      {
        label: translate("contextMenu.copy"),
        icon: <MdContentCopy className={icon} />,
        disabled: !selected || secret,
        onSelect: () => void copyText(selected),
      },
      {
        label: translate("contextMenu.paste"),
        icon: <MdContentPaste className={icon} />,
        disabled: !editable || !navigator.clipboard?.readText,
        onSelect: () => {
          void navigator.clipboard
            .readText()
            .then((text) => {
              if (!text) return;
              restore();
              document.execCommand("insertText", false, text);
            })
            .catch(() => {
              // Clipboard reading refused: Ctrl+V still works.
            });
        },
      },
      { type: "divider" },
      {
        label: translate("contextMenu.selectAll"),
        icon: <MdSelectAll className={icon} />,
        disabled: !field.value,
        onSelect: () => {
          field.focus();
          field.select();
        },
      },
    ];
  }

  const selection = window.getSelection()?.toString() ?? "";
  const link = target?.closest("a[href]") as HTMLAnchorElement | null;
  const image = target?.closest("img");
  const imageSrc = image?.currentSrc || image?.getAttribute("src") || "";
  return [
    selection.trim() && {
      label: translate("contextMenu.copy"),
      icon: <MdContentCopy className={icon} />,
      onSelect: () => void copyText(selection),
    },
    { type: "divider" },
    link && {
      label: translate("contextMenu.openLink"),
      icon: <MdOpenInNew className={icon} />,
      onSelect: () => void window.open(link.href, "_blank", "noopener"),
    },
    link && {
      label: translate("contextMenu.copyLink"),
      icon: <MdLink className={icon} />,
      onSelect: () => void copyText(link.href),
    },
    { type: "divider" },
    imageSrc && {
      label: translate("contextMenu.copyImage"),
      icon: <MdImage className={icon} />,
      onSelect: () => void copyImageOrLink(imageSrc),
    },
    imageSrc && {
      label: translate("groups.contextMenu.openImage"),
      icon: <MdOpenInNew className={icon} />,
      onSelect: () => void window.open(imageSrc, "_blank", "noopener"),
    },
    imageSrc &&
      !imageSrc.startsWith("data:") && {
        label: translate("groups.contextMenu.copyImageLink"),
        icon: <MdLink className={icon} />,
        onSelect: () => void copyText(imageSrc),
      },
  ];
}

/**
 * While the calling component is mounted, the browser's right-click menu does
 * not open anywhere on the page — dialogs and popovers included, since they
 * are drawn outside the component. A menu of ours opened by the thing under
 * the pointer wins; otherwise the stand-in above does, when it has anything.
 */
export function useBlockNativeContextMenu(active = true): void {
  useEffect(() => {
    if (!active) return;
    const onContextMenu = (event: MouseEvent) => {
      // One of ours already opened (it prevented the default on the way).
      if (event.defaultPrevented) return;
      // A finger held on a text field is asking for the phone's own
      // selection handles and its cut/copy/paste bar, which beat ours there.
      const target = event.target instanceof Element ? event.target : null;
      if (isTouchPointer() && target?.closest("input, textarea, [contenteditable='true']")) return;
      event.preventDefault();
      openContextMenu(event, { entries: fallbackEntries(event) }, true);
    };
    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, [active]);
}

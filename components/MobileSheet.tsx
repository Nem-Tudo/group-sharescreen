"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useBackHandler } from "@/lib/useBackHandler";
import { useT } from "@/lib/useI18n";

// A bottom sheet: the phone's way of opening something over the page — the
// group's rooms, a room's options — without leaving it.
//
// What makes it feel like one rather than a box that happens to sit at the
// bottom: it slides up from the edge, it has the grab bar, dragging it down
// closes it, and so does Android's back button (see lib/useBackHandler), the
// same as tapping outside or pressing Escape.

/** How far (px) a drag has to travel before letting go closes the sheet. */
const DRAG_CLOSE_PX = 90;

export function MobileSheet({
  open,
  onClose,
  title,
  headerRight,
  children,
  className = "",
  maxHeight = "85dvh",
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  headerRight?: ReactNode;
  children: ReactNode;
  className?: string;
  maxHeight?: string;
}) {
  const t = useT();
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ startY: number; dy: number } | null>(null);
  useBackHandler(open, onClose);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const onTouchStart = (e: React.TouchEvent) => {
    drag.current = { startY: e.touches[0].clientY, dy: 0 };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (!drag.current || !sheetRef.current) return;
    const dy = Math.max(0, e.touches[0].clientY - drag.current.startY);
    drag.current.dy = dy;
    sheetRef.current.style.transform = `translateY(${dy}px)`;
  };
  const onTouchEnd = () => {
    const dy = drag.current?.dy ?? 0;
    drag.current = null;
    if (!sheetRef.current) return;
    if (dy > DRAG_CLOSE_PX) {
      onClose();
      return;
    }
    sheetRef.current.style.transition = "transform 160ms ease-out";
    sheetRef.current.style.transform = "";
    const el = sheetRef.current;
    window.setTimeout(() => {
      el.style.transition = "";
    }, 170);
  };

  return createPortal(
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label={t("common.close")}
        onClick={onClose}
        className="sheet-backdrop-enter absolute inset-0 cursor-default bg-black/45"
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        style={{ maxHeight }}
        className={`sheet-enter absolute inset-x-0 bottom-0 mx-auto flex w-full max-w-lg flex-col rounded-t-3xl bg-white pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-2xl dark:bg-zinc-950 ${className}`}
      >
        {/* Only the top of the sheet drags it: the list inside has to be free
            to scroll without every flick closing the sheet. */}
        <div
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchEnd}
          className="shrink-0 touch-none select-none"
        >
          <div className="flex justify-center pt-2.5 pb-1.5">
            <span className="h-1.5 w-10 rounded-full bg-zinc-300 dark:bg-zinc-700" />
          </div>
          {(title || headerRight) && (
            <div className="flex items-center justify-between gap-2 px-4 pb-2">
              <div className="min-w-0 truncate text-base font-semibold text-zinc-950 dark:text-zinc-50">{title}</div>
              {headerRight}
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3">{children}</div>
      </div>
    </div>,
    document.body
  );
}

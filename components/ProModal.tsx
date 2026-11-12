"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ProPanel } from "@/app/pro/ProPanel";
import { useT } from "@/lib/useI18n";
import { useShake } from "@/lib/useShake";
import { useFeature } from "@/lib/features";
import { PRO_COMPARE_FEATURE, PRO_MODAL_LAYOUT_FEATURE } from "@/app/pro/PlanComparison";
import { useSellsHere } from "@/lib/storePolicy";
import { NotSoldInAppNotice } from "@/components/NotSoldInApp";

export interface ProModalProps {
  open: boolean;
  /** Which plan to open on, from whatever asked for the modal. */
  planId?: string | null;
  /** The door it was opened from (see lib/proSourceAttribution), for the panel's context card. */
  source?: string | null;
  onClose: () => void;
}

const subscribeNothing = () => () => {};

export function ProModal({ open, planId, source, onClose }: ProModalProps) {
  const t = useT();
  const onClient = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const sells = useSellsHere();
  // Held while the panel inside is creating a payment (see ProPanel's
  // onCheckoutLockChange): the dialog shakes and every way out — Escape, the
  // backdrop, the × — is refused until the API answers.
  const [lock, setLock] = useState({ locked: false, shake: false, dialogOpen: false });
  const cardRef = useRef<HTMLDivElement>(null);
  // Wider for the comparison table, which needs a column per plan. Not an
  // exposure — the panel inside reports that.
  const wide = useFeature(PRO_COMPARE_FEATURE, { track: false }).enabled;
  // Wider still with the checkout beside the table. Counted by the panel too.
  const twoPane = useFeature(PRO_MODAL_LAYOUT_FEATURE, { track: false }).enabled && wide;
  // Only when the panel says so, which is not every time it is locked: a new
  // Pix code is requested from inside the Pix dialog, and that dialog lives in
  // this card. Moving the card — `translate` makes it the box its fixed
  // children are placed against — would drag the Pix dialog along with it.
  useShake(() => cardRef.current, open && lock.shake);

  const handleLockChange = useCallback((next: { locked: boolean; shake: boolean; dialogOpen: boolean }) => {
    setLock((current) =>
      current.locked === next.locked && current.shake === next.shake && current.dialogOpen === next.dialogOpen
        ? current
        : next
    );
  }, []);
  const guardedClose = useCallback(() => {
    if (!lock.locked) onClose();
  }, [lock.locked, onClose]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !lock.dialogOpen) guardedClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, guardedClose, lock.dialogOpen]);

  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [open]);

  if (!onClient || !open) return null;

  // The iOS app sells nothing (lib/storePolicy.ts): a lock still opens this,
  // and gets a plain "this is part of Pro" instead of plans and prices.
  if (!sells) {
    return createPortal(
      <div
        className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-3 sm:p-4 backdrop-blur-sm"
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-label={t("common.golivePro")}
      >
        <div
          className="relative w-full max-w-sm rounded-2xl border border-zinc-200 bg-zinc-50 shadow-2xl dark:border-zinc-800 dark:bg-black"
          onClick={(e) => e.stopPropagation()}
        >
          <NotSoldInAppNotice onClose={onClose} />
        </div>
      </div>,
      document.body
    );
  }

  return createPortal(
    <div
      // Above the popup layer (60, see globals.css) rather than at 50, because
      // this is opened *from* popups now — a locked control in the theme
      // editor asking what Pro Max is. Still below the incoming-call ring at
      // 100: a pricing page must never bury a phone that is ringing.
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-3 sm:p-4 backdrop-blur-sm"
      onClick={guardedClose}
      role="dialog"
      aria-modal="true"
      aria-busy={lock.locked || undefined}
      aria-label={t("common.golivePro")}
    >
      <div
        ref={cardRef}
        className={`relative flex max-h-[90dvh] w-full ${wide ? "max-w-3xl" : "max-w-2xl"} ${twoPane ? "lg:max-w-6xl" : ""} flex-col overflow-y-auto rounded-2xl border border-zinc-200 bg-zinc-50 shadow-2xl dark:border-zinc-800 dark:bg-black`}
        onClick={(e) => e.stopPropagation()}
      >
        <ProPanel
          isModal
          initialPlanId={planId ?? undefined}
          source={source ?? null}
          onClose={guardedClose}
          onCheckoutLockChange={handleLockChange}
        />
      </div>
    </div>,
    document.body
  );
}

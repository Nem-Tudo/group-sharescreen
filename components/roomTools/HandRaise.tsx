"use client";

import { useState } from "react";
import { MdBackHand, MdClose, MdMic, MdMicOff, MdOutlineBackHand } from "react-icons/md";
import { roomTools, useRoomTools } from "@/lib/roomTools";
import { useT } from "@/lib/useI18n";

// Raising a hand: everybody's, no plan involved. A hand up is a question to
// the room's managers — "may I speak?" — and in a room whose microphones are
// off, a manager answering it is what lets that one person talk (see the
// API's roomTools.ts speakers and canUseRoomPermission).

/** The button for your own hand. */
export function RaiseHandButton({ selfUserId, className = "" }: { selfUserId: string | null; className?: string }) {
  const t = useT();
  const { hands, speakers } = useRoomTools();
  const raised = Boolean(selfUserId && hands.some((h) => h.id === selfUserId));
  // A manager answered: we may speak now, whatever the room's mics say.
  const speaker = Boolean(selfUserId && speakers.includes(selfUserId));
  const label = raised
    ? t("roomTools.hands.lower")
    : speaker
      ? t("roomTools.hands.youMaySpeak")
      : t("roomTools.hands.raise");
  return (
    <button
      type="button"
      onClick={() => roomTools.raiseHand(!raised)}
      aria-pressed={raised}
      aria-label={label}
      title={label}
      className={`relative flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
        raised
          ? "bg-amber-500 text-white hover:bg-amber-600"
          : "bg-zinc-200 text-zinc-800 hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
      } ${className}`}
    >
      {raised ? <MdBackHand className="h-5 w-5 shrink-0" /> : <MdOutlineBackHand className="h-5 w-5 shrink-0" />}
      {speaker && (
        <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-600 text-white ring-2 ring-zinc-100 dark:ring-zinc-900">
          <MdMic className="h-2.5 w-2.5" />
        </span>
      )}
    </button>
  );
}

/**
 * The queue of raised hands, for the room's managers: who asked, in order,
 * and the "let them speak" answer. Also who was let in, to take it back.
 */
export function HandsQueue({
  isManager,
  micsLocked,
  nameOf,
}: {
  isManager: boolean;
  // Whether the room's microphones are off for ordinary members — what makes
  // "Liberar fala" mean something.
  micsLocked: boolean;
  nameOf: (userId: string) => string | null;
}) {
  const t = useT();
  const { hands, speakers } = useRoomTools();
  const [collapsed, setCollapsed] = useState(false);
  // Only while the room keeps microphones to its managers: with them open
  // again the hands are kept (not cleared) and come back if they are closed.
  if (!isManager || !micsLocked || (hands.length === 0 && speakers.length === 0)) return null;
  const ordered = [...hands].sort((a, b) => a.at - b.at);

  return (
    <aside className="fixed left-3 top-20 z-[57] w-[min(18rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-amber-300 bg-white shadow-xl dark:border-amber-700/60 dark:bg-zinc-900">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center gap-2 bg-amber-50 px-3 py-2 text-left text-sm font-semibold text-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
      >
        <MdBackHand className="h-4 w-4" />
        <span className="flex-1">{t("roomTools.hands.title", { count: hands.length })}</span>
        <span className="text-xs font-normal">{collapsed ? "▸" : "▾"}</span>
      </button>
      {!collapsed && (
        <div className="flex max-h-[50vh] flex-col gap-1 overflow-y-auto p-2">
          {micsLocked && hands.length > 0 && (
            <p className="px-1 pb-1 text-[11px] text-zinc-500">{t("roomTools.hands.lockedHint")}</p>
          )}
          {ordered.map((hand, index) => (
            <div key={hand.id} className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800/60">
              <span className="w-4 text-right text-xs tabular-nums text-zinc-400">{index + 1}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-zinc-800 dark:text-zinc-100">
                {nameOf(hand.id) ?? hand.name}
              </span>
              <button
                type="button"
                onClick={() => roomTools.grantSpeaker(hand.id)}
                title={t("roomTools.hands.grant")}
                className="flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700"
              >
                <MdMic className="h-3.5 w-3.5" />
                {t("roomTools.hands.grantShort")}
              </button>
              <button
                type="button"
                onClick={() => roomTools.dismissHand(hand.id)}
                title={t("roomTools.hands.dismiss")}
                aria-label={t("roomTools.hands.dismiss")}
                className="rounded-md p-1 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"
              >
                <MdClose className="h-4 w-4" />
              </button>
            </div>
          ))}
          {speakers.length > 0 && (
            <>
              <p className="mt-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                {t("roomTools.hands.speakers")}
              </p>
              {speakers.map((id) => (
                <div key={id} className="flex items-center gap-2 rounded-md px-1 py-1">
                  <MdMic className="h-4 w-4 text-emerald-600" />
                  <span className="min-w-0 flex-1 truncate text-sm text-zinc-800 dark:text-zinc-100">
                    {nameOf(id) ?? t("roomTools.hands.someoneAway")}
                  </span>
                  <button
                    type="button"
                    onClick={() => roomTools.revokeSpeaker(id)}
                    title={t("roomTools.hands.revoke")}
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                  >
                    <MdMicOff className="h-3.5 w-3.5" />
                    {t("roomTools.hands.revokeShort")}
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </aside>
  );
}

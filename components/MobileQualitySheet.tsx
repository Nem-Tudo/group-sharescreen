"use client";

import { createPortal } from "react-dom";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { ShareFps, ShareResolution } from "@/lib/useRoomMedia";

// The quality question, asked once, at the moment somebody starts
// transmitting from a phone.
//
// Why here and not in the settings menu it also lives in: on a desktop the
// quality dials sit behind a gear somebody can go and find, and the default
// is right often enough that most never do. On a phone none of that holds —
// the screen is small, the settings menu is a scroll away, and the cost of
// getting it wrong is not a slightly soft picture but a dropped stream and a
// hot battery on a connection that could not carry it. Asking at the one
// moment the answer matters is cheaper than a control nobody finds.
//
// Deliberately three options and no dials. The full set (resolution, fps,
// bitrate, profile, smart quality) is five interacting choices, which is a
// reasonable thing to offer someone at a desk and an unreasonable thing to
// put in front of someone about to hit "transmitir" on a phone. Each option
// here is a resolution/fps pair chosen to be obviously different from the
// others — see the descriptions, which name the trade rather than the pixels.

export type MobileQualityChoice = {
  id: string;
  label: string;
  detail: string;
  resolution: ShareResolution;
  fps: ShareFps;
};

// 576p is the floor of the tier ladder for a reason (see useRoomMedia's
// RESOLUTION_DIMENSIONS): below it a shared screen stops being readable, and
// an unreadable stream is not a saving. So the cheapest option here spends
// its savings on frame rate rather than going below that floor.
export const MOBILE_QUALITY_CHOICES: MobileQualityChoice[] = [
  {
    id: "alta",
    label: "Alta",
    detail: "1080p · 30fps — melhor imagem, precisa de boa conexão",
    resolution: "1080p",
    fps: 30,
  },
  {
    id: "media",
    label: "Média",
    detail: "720p · 30fps — equilíbrio entre nitidez e estabilidade",
    resolution: "720p",
    fps: 30,
  },
  {
    id: "baixa",
    label: "Baixa",
    detail: "576p · 24fps — para conexão fraca ou economizar bateria",
    resolution: "576p",
    fps: 24,
  },
];

const subscribeNothing = () => () => {};

export function MobileQualitySheet({
  title = "Qualidade da transmissão",
  currentResolution,
  onChoose,
  onCancel,
}: {
  title?: string;
  // Pre-selects whichever option matches what is already configured, so
  // somebody who picked "Baixa" last time sees that it stuck rather than
  // being asked from scratch every time.
  currentResolution: ShareResolution;
  onChoose: (choice: MobileQualityChoice) => void;
  onCancel: () => void;
}) {
  // Portalled to the body for the same reason the captcha overlay is: this
  // opens from a control that lives inside the room's header, and `fixed`
  // resolves against a transformed ancestor rather than the viewport.
  const onClient = useSyncExternalStore(subscribeNothing, () => true, () => false);

  // Escape closes it, like every other dismissable surface in the room.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  const [pending, setPending] = useState<string | null>(null);
  if (!onClient) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      {/* A sheet from the bottom on a phone and a centred card above it: the
          buttons have to be reachable with a thumb, and a centred dialog on a
          tall screen puts them in the middle where they are not. */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-t-2xl border border-black/10 bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-xl sm:rounded-2xl sm:pb-5 dark:border-white/10 dark:bg-zinc-950"
      >
        <h2 className="text-base font-semibold text-zinc-950 dark:text-zinc-50">{title}</h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Dá para mudar depois nas configurações.
        </p>

        <div className="mt-4 flex flex-col gap-2">
          {MOBILE_QUALITY_CHOICES.map((choice) => {
            const current = choice.resolution === currentResolution;
            return (
              <button
                key={choice.id}
                type="button"
                disabled={pending !== null}
                onClick={() => {
                  // Latched so a double tap cannot start two captures — the
                  // start below is async and the sheet stays up until its
                  // caller unmounts it.
                  setPending(choice.id);
                  onChoose(choice);
                }}
                className={`flex flex-col items-start gap-0.5 rounded-xl border px-4 py-3 text-left transition disabled:opacity-60 ${
                  current
                    ? "border-zinc-950 bg-zinc-50 dark:border-zinc-50 dark:bg-zinc-900"
                    : "border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
                }`}
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="font-medium text-zinc-950 dark:text-zinc-50">
                    {choice.label}
                  </span>
                  {current && (
                    <span className="shrink-0 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                      atual
                    </span>
                  )}
                </span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">{choice.detail}</span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={onCancel}
          className="mt-3 w-full rounded-xl border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          Cancelar
        </button>
      </div>
    </div>,
    document.body
  );
}

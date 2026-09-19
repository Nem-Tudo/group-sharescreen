"use client";

import { createPortal } from "react-dom";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { ShareFps, ShareResolution } from "@/lib/useRoomMedia";
import { useT } from "@/lib/useI18n";
import { translate } from "@/lib/i18n";
import {
  isAndroidSystemAudioSupported,
  prewarmAndroidSystemAudio,
} from "@/lib/androidScreenCapture";

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
//
// Laid out top to bottom as quality, system audio, "Transmitir tela", cancel:
// nothing starts until that button, so both answers are in before it does.
//
// The one control that is not a quality dial is the system-audio checkbox,
// and it is here for a different reason: it is the only place it can be
// asked. Android's screen capture cannot be given sound after the fact — the
// AudioRecord is built from the same MediaProjection consent as the video
// (see lib/androidScreenCapture.ts) — so the answer has to exist before the
// share starts. It is offered unticked every single time, and deliberately
// not remembered: sharing what your phone is playing is a decision about
// this moment, and a box that stayed ticked would eventually broadcast a
// notification, a message tone or a call nobody meant to send to the room.

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
    get label() { return translate("mobileQualitySheet.high"); },
    get detail() { return translate("mobileQualitySheet.n1080p30fpsBestPictureNeedsA"); },
    resolution: "1080p",
    fps: 30,
  },
  {
    id: "media",
    get label() { return translate("mobileQualitySheet.medium"); },
    get detail() { return translate("mobileQualitySheet.n720p30fpsABalanceBetweenSharpness"); },
    resolution: "720p",
    fps: 30,
  },
  {
    id: "baixa",
    get label() { return translate("mobileQualitySheet.low"); },
    get detail() { return translate("mobileQualitySheet.n576p24fpsForAWeakConnection"); },
    resolution: "576p",
    fps: 24,
  },
];

const subscribeNothing = () => () => {};

export function MobileQualitySheet({
  title = translate("common.broadcastQuality"),
  currentResolution,
  onChoose,
  onCancel,
}: {
  title?: string;
  // Pre-selects whichever option matches what is already configured.
  currentResolution: ShareResolution;
  onChoose: (choice: MobileQualityChoice, systemAudio: boolean) => void;
  onCancel: () => void;
}) {
  const t = useT();
  // Always false on open, never restored from anywhere — see the note above
  // the choices for why this one is asked fresh every time.
  const [systemAudio, setSystemAudio] = useState(false);
  // Whether to offer it at all: false in a phone browser and on Android 9 and
  // older, where there is no AudioPlaybackCapture to build on. Starts false
  // so a sheet that opens before the answer arrives does not flash a control
  // it is about to take away.
  const [audioSupported, setAudioSupported] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void isAndroidSystemAudioSupported().then((supported) => {
      if (cancelled) return;
      setAudioSupported(supported);
      // Fetched while the sheet is open and the user is reading it, which is
      // the one moment this costs nothing — the alternative is paying for it
      // between the consent dialog and the first chunk of audio.
      if (supported) prewarmAndroidSystemAudio();
    });
    return () => {
      cancelled = true;
    };
  }, []);
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

  // Starts on whatever is already configured, so somebody who picked "Baixa"
  // last time sees that it stuck; "Média" when nothing here matches it.
  const [choiceId, setChoiceId] = useState(
    () =>
      (MOBILE_QUALITY_CHOICES.find((c) => c.resolution === currentResolution) ?? MOBILE_QUALITY_CHOICES[1]).id
  );
  const choice = MOBILE_QUALITY_CHOICES.find((c) => c.id === choiceId) ?? MOBILE_QUALITY_CHOICES[1];
  const [pending, setPending] = useState(false);
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
          {t("mobileQualitySheet.youCanChangeItLaterIn")}
        </p>

        {/* One selector rather than a button per option: the sheet asks a
            single question, and a column of three big cards pushed the audio
            box and the start button below the fold on a short phone. The
            choice now only picks; starting is the button at the bottom. */}
        <label className="mt-4 block">
          <span className="block text-sm font-medium text-zinc-950 dark:text-zinc-50">
            {t("mobileQualitySheet.quality")}
          </span>
          <select
            value={choiceId}
            disabled={pending}
            onChange={(e) => setChoiceId(e.target.value)}
            className="mt-1.5 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-950 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          >
            {MOBILE_QUALITY_CHOICES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">{choice.detail}</span>
        </label>

        {audioSupported && (
          <label className="mt-3 flex items-start gap-3 rounded-xl border border-zinc-300 px-4 py-3 text-left dark:border-zinc-700">
            <input
              type="checkbox"
              checked={systemAudio}
              disabled={pending}
              onChange={(e) => setSystemAudio(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-zinc-300 dark:border-zinc-700"
            />
            <span>
              <span className="block text-sm font-medium text-zinc-950 dark:text-zinc-50">
                {t("mobileQualitySheet.shareSystemAudio")}
              </span>
              <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                {t("mobileQualitySheet.systemAudioHint")}
              </span>
            </span>
          </label>
        )}

        <button
          type="button"
          disabled={pending}
          onClick={() => {
            // Latched so a double tap cannot start two captures — the start
            // is async and the sheet stays up until its caller unmounts it.
            setPending(true);
            onChoose(choice, systemAudio && audioSupported);
          }}
          className="mt-4 w-full rounded-xl bg-zinc-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
        >
          {t("mobileQualitySheet.startSharing")}
        </button>

        <button
          type="button"
          onClick={onCancel}
          className="mt-3 w-full rounded-xl border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          {t("common.cancel")}
        </button>
      </div>
    </div>,
    document.body
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { MdAutoAwesome, MdClose, MdLock } from "react-icons/md";
import { CAMERA_EFFECT_LABELS } from "@/components/CameraEffectsPanel";
import { useAuth } from "@/lib/AuthContext";
import {
  CAMERA_BACKGROUNDS,
  CAMERA_COLORS,
  CAMERA_FACES,
  CAMERA_FACES_3D,
  CAMERA_REACTIONS,
  CAMERA_WARPS,
  useCameraEffectsSupported,
  useCustomCameraBackground,
} from "@/lib/cameraEffects";
import { useCustomCameraEffects } from "@/lib/cameraCustomEffects";
import { CAMERA_OTHERS_FEATURE, streamIdForOthers, uploadCameraEffectGift } from "@/lib/cameraEffectGift";
import { useStreamBackgroundSources } from "@/lib/cameraStreamBackground";
import { TIER_NAMES } from "@/lib/entitlements";
import { trackFeatureEvent, useFeature } from "@/lib/features";
import { openProModal } from "@/lib/proModal";
import { signalingClient, type SentCameraEffect } from "@/lib/signalingClient";
import { selectCameraEffectSendResult, selectReceivedCameraEffect } from "@/lib/signalingSelectors";
import { useT } from "@/lib/useI18n";
import { useSignalingSelector } from "@/lib/useSignalingSelector";

// "Colocar efeito" (experiment "camera-effect-others"): Pro Max and up put an effect
// on another person's camera, from the menu on that person. It is that person's
// browser that draws it, on their own terms: they are told who did it, one click
// takes it off, one more stops it for good (the setting in /me), and it ends when
// they leave the room. The API decides who may, see "camera-effect-send".

export const CAMERA_OTHERS_EVENTS = {
  send: "camera_others_send", // colocou um efeito em alguém
  refused: "camera_others_refused", // a API recusou (a pessoa bloqueou, câmera desligada, ...)
  locked: "camera_others_locked", // tocou em colocar efeito sem o plano (abriu os planos)
  received: "camera_others_received", // recebeu um efeito de alguém
  remove: "camera_others_remove", // tirou o efeito que recebeu
  block: "camera_others_block", // passou a não receber mais
  unblock: "camera_others_unblock", // voltou a receber
};

function track(name: string) {
  trackFeatureEvent(name, { feature: CAMERA_OTHERS_FEATURE });
}

const TIER = "premium_max" as const;

const CHIP = "cursor-pointer rounded-md px-2 py-1 text-xs font-medium transition";
const CHIP_ON = "bg-emerald-600 text-white";
const CHIP_OFF =
  "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700";

type Picked = Omit<SentCameraEffect, "custom"> & { customId: string };
const NOTHING: Picked = { face: "none", warp: "none", color: "none", background: "none", reactions: "none", customId: "none" };

const READY_GROUPS: { key: "face" | "warp" | "reactions" | "color"; title: string; options: string[] }[] = [
  { key: "face", title: "watch.watchRoom.cameraEffectFace", options: [...CAMERA_FACES, ...CAMERA_FACES_3D] },
  { key: "warp", title: "watch.watchRoom.cameraEffectWarp", options: CAMERA_WARPS },
  { key: "reactions", title: "watch.watchRoom.cameraEffectReactions", options: CAMERA_REACTIONS },
  { key: "color", title: "watch.watchRoom.cameraEffectColor", options: CAMERA_COLORS },
];

const isNothing = (picked: Picked) =>
  picked.face === "none" &&
  picked.warp === "none" &&
  picked.color === "none" &&
  picked.background === "none" &&
  picked.reactions === "none" &&
  picked.customId === "none";

/** The row in the menu on a person, and what opens under it. */
export function CameraEffectForOthersRow({ userId, name, className, iconClassName }: { userId: string; name: string; className: string; iconClassName: string }) {
  const t = useT();
  const { account } = useAuth();
  const enabled = useFeature(CAMERA_OTHERS_FEATURE, { track: Boolean(account) && account?.id !== userId }).enabled;
  const result = useSignalingSelector(selectCameraEffectSendResult);
  const customEffects = useCustomCameraEffects();
  const ownBackground = useCustomCameraBackground();
  const sources = useStreamBackgroundSources();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Picked>(NOTHING);
  const [uploading, setUploading] = useState(false);
  const [uploadFailed, setUploadFailed] = useState(false);
  // So a refusal from an earlier time on this menu is not shown as this one's.
  const [sentAfter, setSentAfter] = useState<number | null>(null);
  // Already uploaded for what is picked: changing the mask keeps the same images.
  const lastGift = useRef<{ key: string; id: string } | null>(null);

  const answer = sentAfter !== null && result && result.seq > sentAfter && result.userId === userId ? result : null;
  useEffect(() => {
    if (answer && !answer.ok) track(CAMERA_OTHERS_EVENTS.refused);
  }, [answer]);

  if (!enabled || !account || account.id === userId) return null;

  if (!account.features?.includes("camera_effect_others")) {
    return (
      <button
        type="button"
        onClick={() => {
          track(CAMERA_OTHERS_EVENTS.locked);
          openProModal("camfx_others", TIER);
        }}
        className={className}
      >
        <MdLock className={`${iconClassName} text-amber-500 opacity-100`} />
        {t("cameraOthers.put")}
        <span className="ml-auto text-[10px] font-semibold text-amber-600 dark:text-amber-400">{TIER_NAMES[TIER]}</span>
      </button>
    );
  }

  const send = async (next: Picked) => {
    setPicked(next);
    setUploadFailed(false);
    setSentAfter(result?.seq ?? 0);
    if (isNothing(next)) {
      signalingClient.sendCameraEffect(userId, null);
      return;
    }
    const customId = next.customId === "none" ? null : next.customId;
    const withBackground = next.background === "custom";
    let giftId: string | null = null;
    if (customId || withBackground) {
      const key = `${customId ?? ""}|${withBackground}`;
      if (lastGift.current?.key === key) {
        giftId = lastGift.current.id;
      } else {
        setUploading(true);
        giftId = await uploadCameraEffectGift(userId, customId, withBackground);
        setUploading(false);
        if (!giftId) {
          setUploadFailed(true);
          return;
        }
        lastGift.current = { key, id: giftId };
      }
    }
    signalingClient.sendCameraEffect(
      userId,
      {
        face: next.face,
        warp: next.warp,
        color: next.color,
        background: next.background,
        reactions: next.reactions,
        custom: customId !== null,
        ...(next.background === "stream" && next.stream ? { stream: next.stream } : {}),
      },
      giftId
    );
    track(CAMERA_OTHERS_EVENTS.send);
  };

  const chip = (selected: boolean) => `${CHIP} ${selected ? CHIP_ON : CHIP_OFF} max-w-full truncate`;

  return (
    <>
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className={className}>
        <MdAutoAwesome className={iconClassName} />
        {t("cameraOthers.put")}
      </button>
      {open && (
        <div className="flex max-h-72 flex-col gap-2 overflow-y-auto rounded-lg bg-zinc-50 p-2 dark:bg-zinc-900">
          <p className="text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">{t("cameraOthers.putHint", { name })}</p>
          {customEffects.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">{t("watch.watchRoom.cameraCustomTitle")}</span>
              <div className="flex flex-wrap gap-1">
                <button type="button" aria-pressed={picked.customId === "none"} onClick={() => void send({ ...picked, customId: "none" })} className={chip(picked.customId === "none")}>
                  {t("watch.watchRoom.cameraEffectNone")}
                </button>
                {customEffects.map((effect) => (
                  <button key={effect.id} type="button" aria-pressed={picked.customId === effect.id} onClick={() => void send({ ...picked, customId: effect.id })} className={chip(picked.customId === effect.id)}>
                    {effect.name || t("watch.watchRoom.cameraCustomUnnamed")}
                  </button>
                ))}
              </div>
            </div>
          )}
          {READY_GROUPS.map(({ key, title, options }) => (
            <div key={key} className="flex flex-col gap-1">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">{t(title)}</span>
              <div className="flex flex-wrap gap-1">
                {options.map((option) => (
                  <button key={option} type="button" aria-pressed={picked[key] === option} onClick={() => void send({ ...picked, [key]: option })} className={chip(picked[key] === option)}>
                    {t((CAMERA_EFFECT_LABELS[key] as Record<string, string>)[option])}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="flex flex-col gap-1">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">{t("watch.watchRoom.cameraEffectBackground")}</span>
            <div className="flex flex-wrap gap-1">
              {CAMERA_BACKGROUNDS.map((option) => (
                <button key={option} type="button" aria-pressed={picked.background === option} onClick={() => void send({ ...picked, background: option, stream: undefined })} className={chip(picked.background === option)}>
                  {t(CAMERA_EFFECT_LABELS.background[option])}
                </button>
              ))}
              {ownBackground && (
                <button type="button" aria-pressed={picked.background === "custom"} onClick={() => void send({ ...picked, background: "custom", stream: undefined })} className={chip(picked.background === "custom")}>
                  {t("watch.watchRoom.cameraEffectCustomBg")}
                </button>
              )}
              {sources.map((source) => {
                const id = streamIdForOthers(source.id);
                return (
                  <button key={source.id} type="button" aria-pressed={picked.stream === id} onClick={() => void send({ ...picked, background: "stream", stream: id })} className={chip(picked.stream === id)}>
                    {source.name}
                  </button>
                );
              })}
            </div>
          </div>
          {!isNothing(picked) && (
            <button type="button" onClick={() => void send(NOTHING)} className={`${CHIP} ${CHIP_OFF} self-start`}>
              {t("cameraOthers.takeOffSent")}
            </button>
          )}
          {uploading && <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{t("watch.watchRoom.cameraEffectsLoading")}</p>}
          {(uploadFailed || (answer && !answer.ok)) && (
            <p className="text-[11px] text-red-600 dark:text-red-400">{t(`cameraOthers.refused.${answer?.reason ?? "unavailable"}`)}</p>
          )}
        </div>
      )}
    </>
  );
}

/** What whoever received an effect sees, for as long as it is on their camera. */
export function ReceivedCameraEffectNotice() {
  const t = useT();
  const { account, updateProfile } = useAuth();
  const received = useSignalingSelector(selectReceivedCameraEffect);
  const supported = useCameraEffectsSupported();
  const showing = Boolean(received && supported && !account?.blockCameraEffects);

  useEffect(() => {
    if (showing) track(CAMERA_OTHERS_EVENTS.received);
  }, [showing, received?.seq]);

  if (!showing || !received) return null;

  const button = "cursor-pointer rounded-md px-2 py-1 text-xs font-medium transition";
  return (
    <div
      role="status"
      className="fixed bottom-24 left-1/2 z-40 flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 shadow-xl dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
    >
      <MdAutoAwesome className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
      <span className="min-w-0">{t("cameraOthers.received", { name: received.fromName })}</span>
      <button
        type="button"
        onClick={() => {
          track(CAMERA_OTHERS_EVENTS.remove);
          signalingClient.clearReceivedCameraEffect();
        }}
        className={`${button} inline-flex items-center gap-1 bg-emerald-600 text-white hover:bg-emerald-700`}
      >
        <MdClose className="h-3.5 w-3.5" />
        {t("cameraOthers.takeOff")}
      </button>
      <button
        type="button"
        onClick={() => {
          track(CAMERA_OTHERS_EVENTS.block);
          signalingClient.clearReceivedCameraEffect();
          void updateProfile({ blockCameraEffects: true });
        }}
        className={`${button} text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800`}
      >
        {t("cameraOthers.blockNow")}
      </button>
    </div>
  );
}

/** The setting, in /me. On by default: whoever does not want it says so once. */
export function ReceiveCameraEffectsSetting({ cardClassName }: { cardClassName: string }) {
  const t = useT();
  const { account, updateProfile } = useAuth();
  const { enabled } = useFeature(CAMERA_OTHERS_FEATURE, { track: false });
  const [saving, setSaving] = useState(false);
  if (!enabled || !account) return null;
  const on = !account.blockCameraEffects;
  return (
    <section className={`${cardClassName} p-2`}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={saving}
        onClick={() => {
          setSaving(true);
          track(on ? CAMERA_OTHERS_EVENTS.block : CAMERA_OTHERS_EVENTS.unblock);
          void updateProfile({ blockCameraEffects: on }).finally(() => setSaving(false));
        }}
        className="flex w-full cursor-pointer items-center gap-3 rounded-lg p-2 text-left disabled:opacity-60"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">{t("cameraOthers.settingTitle")}</span>
          <span className="mt-0.5 block text-xs leading-snug text-zinc-500 dark:text-zinc-400">{t("cameraOthers.settingHint")}</span>
        </span>
        <span className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? "bg-emerald-600" : "bg-zinc-300 dark:bg-zinc-700"}`}>
          <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : ""}`} />
        </span>
      </button>
    </section>
  );
}

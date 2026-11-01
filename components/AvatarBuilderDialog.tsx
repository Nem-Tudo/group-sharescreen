"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { MdAutoAwesome, MdCheck, MdFace, MdShuffle } from "react-icons/md";
import { NewBadge, markFeatureUsed } from "@/components/NewBadge";
import {
  AVATAR_SLOTS,
  DEFAULT_AVATAR_CONFIG,
  avatarConfigFromPath,
  avatarDataUrl,
  avatarOptionSwatch,
  avatarPathFor,
  randomAvatarConfig,
  type AvatarConfig,
  type AvatarSlotKey,
} from "@/lib/avatarBuilder";
import { shapeRoundingClass, stripAvatarShape, type AvatarShape } from "@/lib/avatarShape";
import { trackFeatureEvent, useFeature } from "@/lib/features";
import { useI18n } from "@/lib/useI18n";

// Putting together a free avatar: every choice is a row of options, each one
// shown as the person's own face with that option applied (or a swatch, for a
// colour), so nothing has to be imagined before it is clicked.
//
// Picking only fills in the profile being edited, like a preset does. The
// profile's own save is what stores it.
//
// Portalled to the body for the same reason as ImageCropDialog: it opens from
// inside the profile card, which is overflow-hidden and sits in a popup.

export const AVATAR_BUILDER_FEATURE = "avatar-builder";

export const AVATAR_BUILDER_EVENTS = {
  open: "avatar_builder_open",
  random: "avatar_builder_random",
  apply: "avatar_builder_apply",
  save: "avatar_builder_save",
} as const;

function track(name: string) {
  trackFeatureEvent(name, { feature: AVATAR_BUILDER_FEATURE });
}

/** Whether saving this avatar is saving a built one, for the stats. */
export function trackAvatarBuilderSave(avatar: string | null | undefined) {
  if (avatarConfigFromPath(avatar)) track(AVATAR_BUILDER_EVENTS.save);
}

const TABS = [
  { key: "look", slots: ["gender", "skin", "eyes", "mouth"] },
  { key: "hair", slots: ["hair", "hairColor", "facialHair"] },
  { key: "outfit", slots: ["outfit", "outfitColor"] },
  { key: "extras", slots: ["eyewear", "headwear", "earrings"] },
  { key: "background", slots: ["background"] },
] as const satisfies readonly { key: string; slots: readonly AvatarSlotKey[] }[];

type TabKey = (typeof TABS)[number]["key"];

/**
 * The way into the editor, in the avatar picker. Its own component so the
 * experiment is only asked about (and an exposure only counted) once the picker
 * is actually open, not on every profile somebody looks at.
 */
export function AvatarBuilderEntry({ onOpen }: { onOpen: () => void }) {
  const { t } = useI18n();
  const { enabled } = useFeature(AVATAR_BUILDER_FEATURE, { track: true });
  if (!enabled) return null;
  return (
    <button
      type="button"
      onClick={() => {
        track(AVATAR_BUILDER_EVENTS.open);
        onOpen();
      }}
      className="flex cursor-pointer items-center gap-1.5 self-start rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-800 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
    >
      <MdFace className="h-3.5 w-3.5" />
      {t("avatarBuilder.open")}
      <NewBadge id={AVATAR_BUILDER_FEATURE} />
    </button>
  );
}

function OptionRow({
  slotKey,
  config,
  onChange,
}: {
  slotKey: AvatarSlotKey;
  config: AvatarConfig;
  onChange: (config: AvatarConfig) => void;
}) {
  const { t } = useI18n();
  const slot = AVATAR_SLOTS.find((candidate) => candidate.key === slotKey)!;
  const label = t(`avatarBuilder.slot.${slotKey}`);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {Array.from({ length: slot.count }, (_, index) => {
          const selected = config[slotKey] === index;
          const ring = selected
            ? "border-emerald-500"
            : "border-transparent hover:border-zinc-300 dark:hover:border-zinc-600";
          const common = {
            type: "button" as const,
            onClick: () => onChange({ ...config, [slotKey]: index }),
            "aria-label": `${label} ${index + 1}`,
            "aria-pressed": selected,
          };
          if (slot.kind === "color") {
            return (
              <button
                key={index}
                {...common}
                className={`flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border-2 p-0.5 transition ${ring}`}
              >
                <span
                  className="block h-full w-full rounded-full ring-1 ring-black/10 dark:ring-white/10"
                  style={{ background: avatarOptionSwatch(slotKey, index) }}
                />
              </button>
            );
          }
          return (
            <button
              key={index}
              {...common}
              className={`h-14 w-14 cursor-pointer overflow-hidden rounded-xl border-2 transition ${ring}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={avatarDataUrl({ ...config, [slotKey]: index })} alt="" className="h-full w-full" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function AvatarBuilderDialog({
  current,
  shape,
  onCancel,
  onConfirm,
}: {
  /** The avatar being edited. A built one opens as it is, to be tweaked. */
  current: string | null;
  shape: AvatarShape;
  onCancel: () => void;
  onConfirm: (path: string) => void;
}) {
  const { t } = useI18n();
  const [config, setConfig] = useState<AvatarConfig>(
    () => avatarConfigFromPath(current ? stripAvatarShape(current) : null) ?? DEFAULT_AVATAR_CONFIG
  );
  const [tab, setTab] = useState<TabKey>("look");

  useEffect(() => {
    // Same as ImageCropDialog: the profile's popup closes on Escape too, and
    // one press should back out of this only.
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onCancel();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  const slots: readonly AvatarSlotKey[] = TABS.find((candidate) => candidate.key === tab)!.slots;

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("avatarBuilder.title")}
        className="flex max-h-full w-full max-w-2xl flex-col gap-3 overflow-hidden rounded-2xl border border-zinc-200 bg-white p-4 text-zinc-900 shadow-xl dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
      >
        <h2 className="flex items-center gap-1.5 text-base font-semibold">
          <MdAutoAwesome className="h-4 w-4 text-emerald-500" />
          {t("avatarBuilder.title")}
        </h2>

        <div className="flex min-h-0 flex-1 flex-col gap-3 sm:flex-row sm:gap-4">
          <div className="flex shrink-0 flex-row items-center justify-center gap-3 sm:w-44 sm:flex-col sm:justify-start">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={avatarDataUrl(config)}
              alt=""
              className={`h-24 w-24 shadow-md sm:h-40 sm:w-40 ${shapeRoundingClass(shape)}`}
            />
            <button
              type="button"
              onClick={() => {
                track(AVATAR_BUILDER_EVENTS.random);
                setConfig(randomAvatarConfig());
              }}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-800 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <MdShuffle className="h-3.5 w-3.5" />
              {t("avatarBuilder.random")}
            </button>
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
            <div role="tablist" className="flex shrink-0 gap-1 overflow-x-auto">
              {TABS.map(({ key }) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  onClick={() => setTab(key)}
                  className={`shrink-0 cursor-pointer rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                    tab === key
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  }`}
                >
                  {t(`avatarBuilder.tab.${key}`)}
                </button>
              ))}
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1 sm:h-80 sm:flex-none">
              {slots.map((slotKey) => (
                <OptionRow key={slotKey} slotKey={slotKey} config={config} onChange={setConfig} />
              ))}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="cursor-pointer rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={() => {
              track(AVATAR_BUILDER_EVENTS.apply);
              markFeatureUsed(AVATAR_BUILDER_FEATURE);
              onConfirm(avatarPathFor(config));
            }}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-emerald-700"
          >
            <MdCheck className="h-4 w-4" />
            {t("avatarBuilder.apply")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

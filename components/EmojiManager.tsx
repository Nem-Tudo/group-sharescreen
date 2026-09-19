"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { MdAddPhotoAlternate, MdCheck, MdDeleteOutline, MdEdit } from "react-icons/md";
import { CustomEmoji } from "@/components/CustomEmoji";
import { markFeatureUsed } from "@/components/NewBadge";
import { inputClass, primaryButton, secondaryButton, type PopupProps, DialogFrame } from "@/components/groups/dialogKit";
import { trackFeatureEvent } from "@/lib/features";
import {
  CUSTOM_EMOJI_BADGE,
  CUSTOM_EMOJI_EVENTS,
  CUSTOM_EMOJI_FEATURE,
  EMOJI_IMAGE_MAX_BYTES,
  EMOJI_NAME_RE,
  createEmoji,
  deleteEmoji,
  fetchManagedEmojis,
  invalidateCustomEmojis,
  nameFromFile,
  prepareEmojiImage,
  renameEmoji,
  type EmojiOwner,
  type ManagedEmoji,
  type ManagedEmojiList,
} from "@/lib/customEmoji";
import { openProModal } from "@/lib/proModal";
import { useI18n } from "@/lib/useI18n";

// Adding, renaming and deleting custom emoji — a group's (its settings'
// "Emojis" tab) or an account's own (the "Seus emojis" popup, from the
// picker). One component for both: they differ only in whose they are, how
// many fit and who may change them, which the API answers (see
// lib/customEmoji's fetchManagedEmojis).

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

export function EmojiManager({
  owner,
  /** A line under the count saying where the limit comes from — the aura level, the plan. */
  limitHint,
}: {
  owner: EmojiOwner;
  limitHint?: string;
}) {
  const { t } = useI18n();
  const [list, setList] = useState<ManagedEmojiList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<{ name: string; image: string; bytes: number } | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const ownerKey = owner === "mine" ? "mine" : owner.group;

  useEffect(() => {
    let cancelled = false;
    void fetchManagedEmojis(owner).then((result) => {
      if (cancelled) return;
      if (result.ok) setList(result);
      else setError(result.error);
    });
    return () => {
      cancelled = true;
    };
    // The owner is fully described by its key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerKey]);

  // Everybody may look; changing them is the API's to allow — a group's needs
  // "Gerenciar grupo", an account's is always its own.
  const canManage = owner === "mine" ? true : Boolean(list?.canManage);
  const full = list ? list.emojis.length >= list.limit : true;

  function applied(result: Awaited<ReturnType<typeof fetchManagedEmojis>>): boolean {
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    setList((previous) => ({ ...result, canManage: result.canManage ?? previous?.canManage }));
    setError(null);
    invalidateCustomEmojis();
    return true;
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    try {
      const prepared = await prepareEmojiImage(file);
      if (prepared.bytes > EMOJI_IMAGE_MAX_BYTES) {
        setError(t("customEmoji.tooBig", { kb: EMOJI_IMAGE_MAX_BYTES / 1024 }));
        return;
      }
      setDraft({ name: nameFromFile(file.name), image: prepared.dataUrl, bytes: prepared.bytes });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function upload(e: FormEvent) {
    e.preventDefault();
    if (!draft || busy || !EMOJI_NAME_RE.test(draft.name)) return;
    setBusy(true);
    const result = await createEmoji(owner, draft.name, draft.image);
    setBusy(false);
    if (applied(result)) {
      setDraft(null);
      markFeatureUsed(CUSTOM_EMOJI_BADGE);
      trackFeatureEvent(CUSTOM_EMOJI_EVENTS.create, {
        feature: CUSTOM_EMOJI_FEATURE,
        ...(owner === "mine" ? {} : { group: owner.group }),
      });
    }
  }

  async function saveName(emoji: ManagedEmoji, name: string) {
    setEditing(null);
    if (name === emoji.name) return;
    setBusy(true);
    applied(await renameEmoji(owner, emoji.id, name));
    setBusy(false);
  }

  async function remove(emoji: ManagedEmoji) {
    setBusy(true);
    applied(await deleteEmoji(owner, emoji.id));
    setBusy(false);
  }

  if (!list) {
    return error ? <p className="text-sm text-red-500">{error}</p> : <p className="text-sm text-zinc-500">{t("common.loading")}</p>;
  }

  // An account without the plan: what it would get, and the way to it.
  if (owner === "mine" && list.limit === 0 && list.emojis.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{t("customEmoji.yoursNeedPlan")}</p>
        <button type="button" onClick={() => openProModal("premium_max")} className={`${primaryButton} self-start`}>
          {t("groups.aura.getAuras")}
        </button>
      </div>
    );
  }

  const draftValid = draft ? EMOJI_NAME_RE.test(draft.name) : false;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            {t("customEmoji.slotsUsed", { used: list.emojis.length, limit: list.limit })}
          </p>
          {limitHint && <p className="text-xs text-zinc-500 dark:text-zinc-400">{limitHint}</p>}
        </div>
        {canManage && (
          <>
            <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => void onFile(e)} />
            <button
              type="button"
              disabled={busy || full || !list.available}
              onClick={() => fileRef.current?.click()}
              className={primaryButton}
            >
              <span className="flex items-center gap-1.5">
                <MdAddPhotoAlternate className="h-4 w-4" />
                {t("customEmoji.upload")}
              </span>
            </button>
          </>
        )}
      </div>
      {canManage && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {t("customEmoji.uploadRules", { kb: EMOJI_IMAGE_MAX_BYTES / 1024 })}
        </p>
      )}

      {draft && (
        <form
          onSubmit={(e) => void upload(e)}
          className="flex flex-wrap items-center gap-2 rounded-lg border border-violet-300 bg-violet-50 p-2 dark:border-violet-500/40 dark:bg-violet-500/10"
        >
          {/* The picture as it will go up — a data URL, not yet on the CDN. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={draft.image} alt="" className="h-10 w-10 object-contain" />
          <label className="flex min-w-0 flex-1 items-center rounded-lg border border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900">
            <span className="pl-2 font-mono text-sm text-zinc-400">:</span>
            <input
              value={draft.name}
              onChange={(e) =>
                setDraft({ ...draft, name: e.target.value.replace(/[\s-]+/g, "_").replace(/[^A-Za-z0-9_]/g, "").slice(0, 32) })
              }
              autoFocus
              aria-label={t("customEmoji.name")}
              className="min-w-0 flex-1 bg-transparent px-0.5 py-1.5 font-mono text-sm outline-none"
            />
            <span className="pr-2 font-mono text-sm text-zinc-400">:</span>
          </label>
          <button type="submit" disabled={busy || !draftValid} className={primaryButton}>
            {t("common.save")}
          </button>
          <button type="button" disabled={busy} onClick={() => setDraft(null)} className={secondaryButton}>
            {t("common.cancel")}
          </button>
          {!draftValid && <p className="w-full text-xs text-red-500">{t("customEmoji.nameRule")}</p>}
        </form>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}

      {list.emojis.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("customEmoji.noneYet")}</p>
      ) : (
        <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {list.emojis.map((emoji) => (
            <li
              key={emoji.id}
              className={`flex items-center gap-2 rounded-lg border border-zinc-200 px-2 py-1.5 dark:border-zinc-800 ${
                emoji.usable ? "" : "opacity-50"
              }`}
              title={emoji.usable ? undefined : t("customEmoji.overLimit")}
            >
              <CustomEmoji id={emoji.id} name={emoji.name} src={emoji.url} size={32} />
              {editing?.id === emoji.id ? (
                <form
                  className="flex min-w-0 flex-1 items-center gap-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (EMOJI_NAME_RE.test(editing.name)) void saveName(emoji, editing.name);
                  }}
                >
                  <input
                    value={editing.name}
                    onChange={(e) =>
                      setEditing({ id: emoji.id, name: e.target.value.replace(/[^A-Za-z0-9_]/g, "").slice(0, 32) })
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.stopPropagation();
                        setEditing(null);
                      }
                    }}
                    autoFocus
                    aria-label={t("customEmoji.name")}
                    className={`${inputClass} !py-1 font-mono`}
                  />
                  <button
                    type="submit"
                    aria-label={t("common.save")}
                    className="cursor-pointer rounded-md p-1 text-emerald-600 hover:bg-emerald-500/10"
                  >
                    <MdCheck className="h-4 w-4" />
                  </button>
                </form>
              ) : (
                <span className="min-w-0 flex-1 truncate font-mono text-sm">:{emoji.name}:</span>
              )}
              {canManage && editing?.id !== emoji.id && (
                <span className="flex shrink-0 gap-0.5">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setEditing({ id: emoji.id, name: emoji.name })}
                    aria-label={t("customEmoji.rename")}
                    title={t("customEmoji.rename")}
                    className="cursor-pointer rounded-md p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 disabled:opacity-50 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                  >
                    <MdEdit className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void remove(emoji)}
                    aria-label={t("customEmoji.delete")}
                    title={t("customEmoji.delete")}
                    className="cursor-pointer rounded-md p-1 text-red-600 hover:bg-red-500/10 disabled:opacity-50"
                  >
                    <MdDeleteOutline className="h-4 w-4" />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The "Seus emojis" popup — registered as "my_emojis" in components/NtPopups. */
export function MyEmojisDialog({ closePopup }: PopupProps<object>) {
  const { t } = useI18n();
  return (
    <DialogFrame title={t("customEmoji.yourEmojis")} onClose={() => closePopup(false)} wide>
      <div className="flex flex-col gap-3 pb-1">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{t("customEmoji.yoursIntro")}</p>
        <EmojiManager owner="mine" limitHint={t("customEmoji.yoursLimitHint")} />
      </div>
    </DialogFrame>
  );
}

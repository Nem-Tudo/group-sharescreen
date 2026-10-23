"use client";

import { useMemo, useState } from "react";
import {
  MdAdd,
  MdCheck,
  MdDeleteOutline,
  MdDownload,
  MdFolderOpen,
  MdGraphicEq,
} from "react-icons/md";
import { Popover } from "@/components/Tooltip";
import {
  clearSoundboardError,
  downloadRemoteSoundboardSound,
  openLocalSoundboardFolder,
  pickSoundboardImport,
  playLocalSoundboardSound,
  refreshLocalSoundboard,
  removeLocalSoundboardSound,
  saveSoundboardImport,
  useSoundboardSnapshot,
  type PendingSoundboardImport,
} from "@/lib/soundboard";
import { useT } from "@/lib/useI18n";

function durationLabel(durationMs: number): string {
  const seconds = durationMs / 1000;
  return `${seconds >= 10 || Number.isInteger(seconds) ? seconds.toFixed(0) : seconds.toFixed(1)}s`;
}

function initialName(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[^.]+$/, "").trim();
  return (withoutExtension || "Sound").slice(0, 40);
}

export function SoundboardButton() {
  const t = useT();
  const soundboard = useSoundboardSnapshot();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<PendingSoundboardImport | null>(null);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("🔊");
  const [busy, setBusy] = useState(false);

  const ownedHashes = useMemo(
    () => new Set(soundboard.localSounds.map((sound) => sound.hash)),
    [soundboard.localSounds]
  );
  const remoteCatalogs = soundboard.remoteCatalogs.filter((catalog) => catalog.sounds.length > 0);

  if (!soundboard.active || !soundboard.canManageLibrary) return null;

  async function chooseFile() {
    setBusy(true);
    const picked = await pickSoundboardImport();
    setBusy(false);
    if (!picked) return;
    setPending(picked);
    setName(initialName(picked.fileName));
    setEmoji("🔊");
  }

  async function save() {
    if (!pending || !name.trim() || !emoji.trim()) return;
    setBusy(true);
    const ok = await saveSoundboardImport(pending, name, emoji);
    setBusy(false);
    if (ok) setPending(null);
  }

  const panel = (
    <div className="w-[22rem] max-w-[calc(100vw-2rem)] rounded-xl border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center gap-2">
        <MdGraphicEq className="h-5 w-5 text-emerald-600" />
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {t("soundboard.title")}
        </h3>
        <button
          type="button"
          onClick={() => void openLocalSoundboardFolder()}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
          aria-label={t("soundboard.openFolder")}
          title={t("soundboard.openFolder")}
        >
          <MdFolderOpen className="h-4 w-4" />
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void chooseFile()}
          className="flex h-8 items-center gap-1 rounded-lg bg-emerald-600 px-2.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
        >
          <MdAdd className="h-4 w-4" />
          {t("soundboard.addSound")}
        </button>
      </div>

      {soundboard.errorKey && (
        <div className="mt-2 flex items-start gap-2 rounded-lg bg-red-50 px-2.5 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">
          <span className="min-w-0 flex-1">{t(soundboard.errorKey)}</span>
          <button
            type="button"
            onClick={clearSoundboardError}
            className="shrink-0 font-bold leading-none opacity-70 hover:opacity-100"
            aria-label={t("common.close")}
          >
            ×
          </button>
        </div>
      )}

      {pending && (
        <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-2.5">
          <div className="grid grid-cols-[3.5rem_1fr] gap-2">
            <label className="flex flex-col gap-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
              {t("soundboard.emoji")}
              <input
                value={emoji}
                maxLength={16}
                onChange={(event) => setEmoji(event.target.value)}
                className="h-9 rounded-lg border border-zinc-200 bg-white px-2 text-center text-lg outline-none focus:border-emerald-500 dark:border-zinc-800 dark:bg-zinc-900"
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
              {t("soundboard.soundName")}
              <input
                value={name}
                maxLength={40}
                onChange={(event) => setName(event.target.value)}
                className="h-9 min-w-0 rounded-lg border border-zinc-200 bg-white px-2 text-sm text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
              />
            </label>
          </div>
          <p className="mt-1.5 truncate text-[11px] text-zinc-500" title={pending.fileName}>
            {pending.fileName} · {durationLabel(pending.durationMs)}
          </p>
          <div className="mt-2 flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setPending(null)}
              className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              disabled={busy || !name.trim() || !emoji.trim()}
              onClick={() => void save()}
              className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {t("soundboard.save")}
            </button>
          </div>
        </div>
      )}

      <section className="mt-3">
        <div className="mb-1.5 flex items-center justify-between">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {t("soundboard.mySounds")}
          </h4>
          <button
            type="button"
            onClick={() => void refreshLocalSoundboard()}
            className="text-[11px] text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            {t("common.refresh")}
          </button>
        </div>
        {soundboard.localSounds.length === 0 ? (
          <p className="rounded-lg bg-zinc-50 px-3 py-4 text-center text-xs text-zinc-500 dark:bg-zinc-900/60">
            {t("soundboard.noSounds")}
          </p>
        ) : (
          <div className="grid max-h-48 grid-cols-4 gap-1.5 overflow-y-auto pr-1">
            {soundboard.localSounds.map((sound) => (
              <div
                key={sound.id}
                className="group relative min-w-0 rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60"
              >
                <button
                  type="button"
                  onClick={() => void playLocalSoundboardSound(sound.id)}
                  className="flex h-20 w-full min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1.5 pb-4 pt-2 transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
                  title={`${sound.name} · ${durationLabel(sound.durationMs)}`}
                >
                  <span className="text-2xl leading-none">{sound.emoji}</span>
                  <span className="w-full truncate text-center text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
                    {sound.name}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void removeLocalSoundboardSound(sound.id)}
                  className="absolute bottom-1 right-1 flex h-5 w-5 items-center justify-center rounded text-zinc-400 opacity-0 transition hover:bg-red-500/10 hover:text-red-600 group-hover:opacity-100 focus:opacity-100"
                  aria-label={t("soundboard.remove")}
                  title={t("soundboard.remove")}
                >
                  <MdDeleteOutline className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        <p className="mt-1.5 text-[10px] leading-snug text-zinc-500 dark:text-zinc-500">
          {t("soundboard.restartHint")}
        </p>
      </section>

      <section className="mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
        <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          {t("soundboard.callSounds")}
        </h4>
        {remoteCatalogs.length === 0 ? (
          <p className="rounded-lg bg-zinc-50 px-3 py-4 text-center text-xs text-zinc-500 dark:bg-zinc-900/60">
            {t("soundboard.noCallSounds")}
          </p>
        ) : (
          <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
            {remoteCatalogs.map((catalog) => (
              <div key={catalog.peerId}>
                <p className="mb-1 truncate text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                  {catalog.name}
                </p>
                <div className="space-y-1">
                  {catalog.sounds.map((sound) => {
                    const owned = ownedHashes.has(sound.hash);
                    const downloading = soundboard.downloading.includes(`${catalog.peerId}:${sound.id}`);
                    return (
                      <div
                        key={sound.id}
                        className="flex items-center gap-2 rounded-lg bg-zinc-50 px-2 py-1.5 dark:bg-zinc-900/60"
                      >
                        <span className="text-lg">{sound.emoji}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium text-zinc-800 dark:text-zinc-200">
                            {sound.name}
                          </span>
                          <span className="block text-[10px] text-zinc-500">
                            {durationLabel(sound.durationMs)}
                          </span>
                        </span>
                        <button
                          type="button"
                          disabled={owned || downloading}
                          onClick={() => downloadRemoteSoundboardSound(catalog.peerId, sound.id)}
                          className="flex h-7 items-center gap-1 rounded-md border border-zinc-200 px-2 text-[11px] font-medium text-zinc-600 transition hover:bg-white disabled:cursor-default disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-950"
                        >
                          {owned ? (
                            <>
                              <MdCheck className="h-3.5 w-3.5" />
                              {t("soundboard.acquired")}
                            </>
                          ) : (
                            <>
                              <MdDownload className="h-3.5 w-3.5" />
                              {downloading ? t("soundboard.downloading") : t("soundboard.download")}
                            </>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      placement="top-end"
      tooltip={t("soundboard.title")}
      content={panel}
    >
      <button
        type="button"
        onClick={() => {
          setOpen((value) => !value);
          if (!open) void refreshLocalSoundboard();
        }}
        aria-label={t("soundboard.title")}
        aria-expanded={open}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 text-zinc-600 transition hover:bg-zinc-100 [@media(max-height:52rem)]:h-7 [@media(max-height:52rem)]:w-7 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900"
      >
        <MdGraphicEq className="h-4 w-4 shrink-0 [@media(max-height:52rem)]:h-3.5 [@media(max-height:52rem)]:w-3.5" />
      </button>
    </Popover>
  );
}

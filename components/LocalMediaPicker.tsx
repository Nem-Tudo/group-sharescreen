"use client";

import { useRef, useState, type ReactNode } from "react";
import { MdFolderOpen, MdInsertDriveFile, MdFolderZip } from "react-icons/md";
import {
  buildLocalMediaQueue,
  localMediaSources,
  ZipError,
  type LocalMediaMode,
  type LocalMediaControlMode,
  type LocalMediaSlot,
} from "@/lib/localMediaSource";

// The "pick something off your own disk" half of both add-source popups (see
// AddVideoSourceModal and AddMusicSourceModal). One component rather than a
// copy each: the three ways in, the zip handling and the error wording are the
// same question being asked in two places, and the only thing that differs is
// what the resulting queue is called once it is playing.
export function LocalMediaPicker({
  mode,
  blockedReason,
  slot,
  hasAccount,
  onReady,
}: {
  // What the tile's transport calls this once it starts — see
  // LocalMediaControls.
  // Presentation only: a local file is played and broadcast the same way
  // either way.
  mode: LocalMediaMode;
  // Why this room won't take a local file from this person, or null when it
  // will. A local file rides the screen channel (see WatchRoom's
  // startLocalMediaShare), so it is the *screen* permission that governs it —
  // which can differ from the permission that let them open this popup at all.
  // Said here rather than left to fail server-side after the popup has closed.
  blockedReason?: string | null;
  // Which slot to fill, or null when all of them are busy. Decided by the
  // caller, which is the only thing that knows what is already playing.
  slot: LocalMediaSlot | null;
  // Whether this person is signed in. Only an account may keep a file to
  // itself — same rule, and same reason, as a room video source's (see the
  // control block below, and allowedControlMode on the server).
  hasAccount: boolean;
  // Called once the queue is loaded, from inside the click that picked the
  // files — the caller starts that slot's channel there, while the browser
  // still counts it as something the user asked for.
  onReady: (slot: LocalMediaSlot, trackCount: number) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const music = mode === "music";
  // Whoever puts a file on keeps the wheel unless they say otherwise — the
  // same default, and the same wording, as a room video source's. A guest
  // starts, and stays, on "anyone": a guest identity lives in a browser
  // profile and is replaced by clearing site data, and a file pinned to an
  // identity that no longer exists is one nobody can steer.
  const [controlMode, setControlMode] = useState<LocalMediaControlMode>(
    hasAccount ? "owner" : "anyone"
  );
  const full = slot === null;
  const blocked = Boolean(blockedReason) || full;

  async function handleFiles(fileList: FileList | null) {
    const files = fileList ? [...fileList] : [];
    if (files.length === 0 || blocked || !slot) return;
    setError(null);
    setLoading(true);
    try {
      const queue = await buildLocalMediaQueue(files);
      if (queue.length === 0) {
        setError(
          files.some((f) => f.name.toLowerCase().endsWith(".zip"))
            ? "Não encontrei nenhum vídeo ou música dentro desse zip."
            : "Nenhum desses arquivos é um vídeo ou uma música que o navegador toque."
        );
        return;
      }
      localMediaSources[slot].setQueue(queue, mode, hasAccount ? controlMode : "anyone");
      onReady(slot, queue.length);
    } catch (err) {
      setError(
        err instanceof ZipError
          ? err.message
          : "Não foi possível abrir esses arquivos. Tente de novo."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Says plainly how this differs from the link options next to it: a
          link is something everybody loads, a file is something only this
          machine has, so it goes out as a transmission instead. */}
      <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
        {blockedReason ??
          (full
            ? "Você já está tocando o máximo de arquivos ao mesmo tempo. Tire um da sala para colocar outro."
            : music
          ? "Uma pasta ou um zip vira uma fila em ordem de nome."
              : "Uma pasta ou um zip vira uma fila em ordem de nome.")}
      </p>

      {/* The same choice the rest of the app offers, with the restricted half
          meaning what it means for this kind of thing: a video is something you
          brought, so it narrows to you; music is the room's soundtrack, so it
          narrows to the room's management the way a YouTube one does. Either
          way the file plays on *this* machine, and everyone else's buttons
          work by relaying what they press back to this browser. */}
      <div className={`flex-col gap-1.5 ${blocked ? "hidden" : "flex"}`}>
        <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Quem pode controlar</p>
        <label
          className={`flex items-center gap-2 text-sm ${
            hasAccount ? "" : "cursor-not-allowed opacity-50"
          }`}
        >
          <input
            type="radio"
            name={`local-media-control-${mode}`}
            checked={controlMode === "owner" && hasAccount}
            disabled={!hasAccount}
            onChange={() => setControlMode("owner")}
          />
          {music ? "Só o dono e os administradores" : "Só eu posso controlar"}
        </label>
        {!hasAccount && (
          <p className="-mt-1 pl-6 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
            Conta necessária.
          </p>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name={`local-media-control-${mode}`}
            checked={controlMode === "anyone" || !hasAccount}
            onChange={() => setControlMode("anyone")}
          />
          Todos podem controlar
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <PickerButton
          icon={<MdInsertDriveFile className="h-4 w-4 shrink-0 text-sky-500" />}
          label="Escolher arquivos"
          hint={music ? "Uma ou várias músicas" : "Um ou vários vídeos ou músicas"}
          disabled={loading || blocked}
          onClick={() => fileInputRef.current?.click()}
        />
        <PickerButton
          icon={<MdFolderOpen className="h-4 w-4 shrink-0 text-amber-500" />}
          label="Escolher uma pasta"
          hint="Toca tudo que der, em ordem"
          disabled={loading || blocked}
          onClick={() => folderInputRef.current?.click()}
        />
        <PickerButton
          icon={<MdFolderZip className="h-4 w-4 shrink-0 text-violet-500" />}
          label="Escolher um .zip"
          hint="Aberto aqui mesmo, sem extrair antes"
          disabled={loading || blocked}
          onClick={() => zipInputRef.current?.click()}
        />
      </div>

      {loading && <p className="text-xs text-zinc-500 dark:text-zinc-400">Abrindo os arquivos...</p>}
      {error && <p className="text-xs text-red-500">{error}</p>}

      {/* The three inputs are the actual pickers; the buttons above are what
          they look like. `webkitdirectory` is the only way a browser offers to
          choose a folder, and it hands back a flat list of everything inside,
          which is exactly the shape buildLocalMediaQueue wants. */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={music ? "audio/*" : "video/*,audio/*"}
        hidden
        onChange={(e) => {
          void handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        hidden
        // Not in React's HTML types — it is a non-standard attribute every
        // browser that supports folder picking implements under this name.
        {...({ webkitdirectory: "" } as Record<string, string>)}
        onChange={(e) => {
          void handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={zipInputRef}
        type="file"
        accept=".zip,application/zip"
        hidden
        onChange={(e) => {
          void handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function PickerButton({
  icon,
  label,
  hint,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  hint: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-2.5 rounded-lg border border-zinc-300 px-3 py-2.5 text-left transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
    >
      {icon}
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{label}</span>
        <span className="block truncate text-[11px] text-zinc-500 dark:text-zinc-400">{hint}</span>
      </span>
    </button>
  );
}

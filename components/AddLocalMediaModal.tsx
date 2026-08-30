"use client";

import { useRef, useState, type ReactNode } from "react";
import { MdFolderOpen, MdInsertDriveFile, MdFolderZip } from "react-icons/md";
import { buildLocalMediaQueue, localMediaSource, ZipError } from "@/lib/localMediaSource";
import { BetaMark } from "./BetaMark";

export type AddLocalMediaPopupData = {
  // Called once the queue is loaded. The caller starts the share from here —
  // and it matters that this happens inside the click that submitted the
  // form, since a browser only grants the capture a user gesture asked for.
  onReady: (trackCount: number) => void;
};

// The picker behind "Transmitir arquivo" (see WatchRoom.tsx) — an ntpopups
// popup, registered as "add_local_media" in NtPopups.tsx.
//
// Three ways in, because they are three genuinely different things someone
// has on their disk: one file, a folder of them, or a zip. All three end up as
// the same queue (see lib/localMediaSource.ts), which is then broadcast to the
// room as an ordinary transmission.
export function AddLocalMediaModal({
  closePopup,
  data: { onReady },
}: {
  closePopup: (hasAction?: boolean) => void;
  data: AddLocalMediaPopupData;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(fileList: FileList | null) {
    const files = fileList ? [...fileList] : [];
    if (files.length === 0) return;
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
      localMediaSource.setQueue(queue);
      onReady(queue.length);
      closePopup(true);
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
    <div className="flex w-80 max-w-[calc(100vw-1rem)] flex-col gap-4 bg-white p-4 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold">
          <BetaMark /> Transmitir arquivo do computador
        </p>
        <button
          type="button"
          onClick={() => closePopup(false)}
          aria-label="Fechar"
          className="-mr-1 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-lg leading-none opacity-60 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
        >
          ×
        </button>
      </div>

      <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
        O arquivo toca aqui no seu computador e a sala recebe como uma
        transmissão — igual a compartilhar a tela, mas sem a tela. Nada é
        enviado para nenhum servidor, e você controla o play, a pausa e a fila.
        Escolher uma pasta ou um zip vira uma fila em ordem de nome.
      </p>

      <div className="flex flex-col gap-2">
        <PickerButton
          icon={<MdInsertDriveFile className="h-4 w-4 shrink-0 text-sky-500" />}
          label="Escolher arquivos"
          hint="Um ou vários vídeos ou músicas"
          disabled={loading}
          onClick={() => fileInputRef.current?.click()}
        />
        <PickerButton
          icon={<MdFolderOpen className="h-4 w-4 shrink-0 text-amber-500" />}
          label="Escolher uma pasta"
          hint="Toca tudo que der, em ordem"
          disabled={loading}
          onClick={() => folderInputRef.current?.click()}
        />
        <PickerButton
          icon={<MdFolderZip className="h-4 w-4 shrink-0 text-violet-500" />}
          label="Escolher um .zip"
          hint="Aberto aqui mesmo, sem extrair antes"
          disabled={loading}
          onClick={() => zipInputRef.current?.click()}
        />
      </div>

      {loading && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">Abrindo os arquivos...</p>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}

      {/* The three inputs are the actual pickers; the buttons above are what
          they look like. `webkitdirectory` is the only way a browser offers to
          choose a folder, and it hands back a flat list of everything inside,
          which is exactly the shape buildLocalMediaQueue wants. */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="video/*,audio/*"
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

      <p className="text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">
        Toca o que o seu navegador toca: MP4, WebM, MP3, M4A, OGG, WAV e afins.
        Um arquivo com codec que ele não conhece avisa na hora em vez de falhar
        em silêncio.
      </p>
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

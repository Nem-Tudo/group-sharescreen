"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { MdCloudUpload } from "react-icons/md";
import { uploadPartnerMedia } from "@/lib/adminApi";
import { useT } from "@/lib/useI18n";

// Must match the API's PARTNER_UPLOAD_TYPES (uploadRoutes.ts) — checked here
// first so a wrong file is refused before it travels.
const ACCEPT = {
  image: ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"],
  video: ["video/mp4", "video/webm"],
} as const;

const MAX_MB = { image: 20, video: 500 } as const;

/**
 * Drag a file here, or click "Procurar", and it goes to the CDN (see
 * uploadPartnerMedia); `onUploaded` gets the URL. Used by the partner ad form
 * for the card image, the reward video and pictures in the long description.
 */
export function PartnerMediaDrop({
  kind,
  onUploaded,
  compact = false,
}: {
  kind: "image" | "video";
  onUploaded: (url: string) => void;
  /** One line, for the smaller spots (the description's pictures). */
  compact?: boolean;
}) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [dragging, setDragging] = useState(false);
  // null = idle; 0..1 = uploading.
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A form closed mid-upload shouldn't keep sending a 500 MB video nobody will use.
  useEffect(() => () => abortRef.current?.abort(), []);

  async function upload(file: File | undefined) {
    if (!file || progress !== null) return;
    setError(null);
    if (!(ACCEPT[kind] as readonly string[]).includes(file.type)) {
      setError(kind === "image" ? t("admin.partnerMediaDrop.notAnImage") : t("admin.partnerMediaDrop.notAVideo"));
      return;
    }
    if (file.size > MAX_MB[kind] * 1024 * 1024) {
      setError(t("admin.partnerMediaDrop.tooLarge", { mb: MAX_MB[kind] }));
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setProgress(0);
    try {
      const url = await uploadPartnerMedia(file, setProgress, controller.signal);
      onUploaded(url);
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") {
        setError(err instanceof Error ? err.message : t("admin.partnerAdsPanel.uploadFailed"));
      }
    } finally {
      abortRef.current = null;
      setProgress(null);
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    void upload(e.dataTransfer.files?.[0]);
  }

  const uploading = progress !== null;

  return (
    <div className="mt-1.5">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!uploading) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`relative flex items-center gap-2 overflow-hidden rounded-lg border border-dashed text-xs transition ${
          compact ? "px-3 py-2" : "flex-col justify-center px-3 py-4 text-center"
        } ${
          dragging
            ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
            : "border-zinc-300 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400"
        }`}
      >
        {uploading && (
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 bg-blue-500/15 transition-[width] duration-200"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        )}
        <MdCloudUpload className={`relative shrink-0 ${compact ? "h-4 w-4" : "h-6 w-6"}`} />
        <span className="relative min-w-0 flex-1">
          {uploading
            ? t("admin.partnerMediaDrop.uploading", { percent: Math.round(progress * 100) })
            : kind === "image"
              ? t("admin.partnerMediaDrop.dropImage")
              : t("admin.partnerMediaDrop.dropVideo")}
        </span>
        {uploading ? (
          <button
            type="button"
            onClick={() => abortRef.current?.abort()}
            className="relative shrink-0 font-semibold underline underline-offset-2"
          >
            {t("common.cancel")}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="relative shrink-0 rounded-md border border-zinc-300 bg-white px-2.5 py-1 font-semibold text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {t("admin.partnerMediaDrop.browse")}
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT[kind].join(",")}
          className="hidden"
          onChange={(e) => {
            void upload(e.target.files?.[0]);
            // Picking the same file again should upload again.
            e.target.value = "";
          }}
        />
      </div>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}

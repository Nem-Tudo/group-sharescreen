"use client";

import { useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { MdAdd, MdAttachFile, MdCameraAlt, MdOutlineImage, MdOutlineVideoLibrary } from "react-icons/md";
import { CameraCaptureModal } from "@/components/CameraCaptureModal";
import { Popover } from "@/components/Tooltip";
import { CHAT_IMAGE_ACCEPT } from "@/lib/chatImage";
import { useT } from "@/lib/useI18n";

// The "+" beside a message box: a picture from disk, one taken right now with
// the camera, a video, or any other file. Shared by the room chat, DMs and
// group rooms, which only differ in what happens to what is picked.
//
// Pictures and files go to different handlers because they are different
// things to the chat: a picture is downscaled and drawn inline (`images`), a
// video or document is uploaded as it is and shown as a player or a card
// (`attachments`). A picture picked through "Arquivo" is still a picture —
// the caller decides (see splitPicked).

export function AttachMenu({
  onImages,
  onFiles,
  allowImages = true,
  allowFiles = true,
  disabled = false,
  tooltip,
  limitMb,
  onOpen,
  buttonClassName,
  iconClassName = "h-5 w-5",
  wrapperClassName,
}: {
  onImages: (files: File[]) => void;
  onFiles: (files: File[]) => void;
  allowImages?: boolean;
  allowFiles?: boolean;
  disabled?: boolean;
  tooltip?: ReactNode;
  /** The biggest file this person may send, shown under "Vídeo" and "Arquivo". */
  limitMb?: number | null;
  /** Fired as the menu opens — a moment to ask the API for `limitMb`. */
  onOpen?: () => void;
  buttonClassName: string;
  iconClassName?: string;
  wrapperClassName?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  // Off-screen rather than inside the menu: a file input is the only way to
  // open the system picker, and it has to outlive the menu that clicked it.
  const imageRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function picked(handler: (files: File[]) => void) {
    return (e: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      // Cleared first, so picking the same file twice in a row still fires.
      e.target.value = "";
      if (files.length > 0) handler(files);
    };
  }

  function choose(action: () => void) {
    setOpen(false);
    action();
  }

  const limit = limitMb ? t("attachments.upToMb", { mb: limitMb }) : null;
  const item =
    "flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800";

  return (
    <>
      <input ref={imageRef} type="file" accept={CHAT_IMAGE_ACCEPT} multiple hidden onChange={picked(onImages)} />
      <input ref={videoRef} type="file" accept="video/*" multiple hidden onChange={picked(onFiles)} />
      <input ref={fileRef} type="file" multiple hidden onChange={picked(onFiles)} />
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        placement="top-start"
        wrapperClassName={wrapperClassName}
        tooltip={tooltip ?? t("attachments.attach")}
        content={
          <div className="flex w-56 flex-col rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
            {allowImages && (
              <>
                <button type="button" className={item} onClick={() => choose(() => imageRef.current?.click())}>
                  <MdOutlineImage className="h-5 w-5 shrink-0" aria-hidden />
                  {t("attachments.image")}
                </button>
                <button type="button" className={item} onClick={() => choose(() => setCameraOpen(true))}>
                  <MdCameraAlt className="h-5 w-5 shrink-0" aria-hidden />
                  {t("attachments.takePhoto")}
                </button>
              </>
            )}
            {allowFiles && (
              <>
                <button type="button" className={item} onClick={() => choose(() => videoRef.current?.click())}>
                  <MdOutlineVideoLibrary className="h-5 w-5 shrink-0" aria-hidden />
                  <span className="flex min-w-0 flex-col">
                    {t("attachments.video")}
                    {limit && <span className="text-[11px] text-zinc-400">{limit}</span>}
                  </span>
                </button>
                <button type="button" className={item} onClick={() => choose(() => fileRef.current?.click())}>
                  <MdAttachFile className="h-5 w-5 shrink-0" aria-hidden />
                  <span className="flex min-w-0 flex-col">
                    {t("attachments.file")}
                    {limit && <span className="text-[11px] text-zinc-400">{limit}</span>}
                  </span>
                </button>
              </>
            )}
          </div>
        }
      >
        <button
          type="button"
          onClick={() =>
            setOpen((current) => {
              if (!current) onOpen?.();
              return !current;
            })
          }
          disabled={disabled}
          aria-label={t("attachments.attach")}
          aria-haspopup="menu"
          aria-expanded={open}
          className={buttonClassName}
        >
          <MdAdd className={iconClassName} aria-hidden />
        </button>
      </Popover>
      {/* The still lands wherever a picked picture would. */}
      <CameraCaptureModal open={cameraOpen} onClose={() => setCameraOpen(false)} onCapture={(file) => onImages([file])} />
    </>
  );
}

/**
 * Files picked through "Vídeo"/"Arquivo", or dropped and pasted, split into
 * the pictures the chat draws inline and everything else.
 */
export function splitPicked(
  files: File[],
  isImage: (file: File) => boolean
): { images: File[]; others: File[] } {
  const images: File[] = [];
  const others: File[] = [];
  for (const file of files) (isImage(file) ? images : others).push(file);
  return { images, others };
}

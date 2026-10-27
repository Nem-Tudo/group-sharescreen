"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { MdAttachFile } from "react-icons/md";
import { useT } from "@/lib/useI18n";

// Files dragged from the desktop (or another tab) straight onto a message box
// — the same as picking them with the "+", handed to the caller's handler.
// Behind the "chat-file-drop" experiment; the room chat and group rooms use it.
//
// Only a drag that carries files is taken: dragging selected text into the box
// keeps working as the browser does it.

export const FILE_DROP_FEATURE = "chat-file-drop";

function carriesFiles(e: DragEvent) {
  return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}

export function useFileDrop(onFiles: (files: File[]) => void, enabled: boolean) {
  const [dragging, setDragging] = useState(false);
  // dragenter/dragleave fire for every child crossed on the way; the highlight
  // goes only when the drag has left all of them.
  const depth = useRef(0);

  useEffect(() => {
    if (enabled) return;
    depth.current = 0;
    setDragging(false);
  }, [enabled]);

  const dropProps = enabled
    ? {
        onDragEnter(e: DragEvent) {
          if (!carriesFiles(e)) return;
          e.preventDefault();
          depth.current += 1;
          setDragging(true);
        },
        onDragOver(e: DragEvent) {
          if (!carriesFiles(e)) return;
          // Without this the browser opens the file in place of the page.
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        },
        onDragLeave(e: DragEvent) {
          if (!carriesFiles(e)) return;
          depth.current = Math.max(0, depth.current - 1);
          if (depth.current === 0) setDragging(false);
        },
        onDrop(e: DragEvent) {
          if (!carriesFiles(e)) return;
          e.preventDefault();
          depth.current = 0;
          setDragging(false);
          const files = Array.from(e.dataTransfer.files);
          if (files.length > 0) onFiles(files);
        },
      }
    : {};

  return { dragging, dropProps };
}

/** Covers the box (whose parent must be `relative`) while files hover it. */
export function FileDropOverlay({ show }: { show: boolean }) {
  const t = useT();
  if (!show) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-1 z-30 flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-blue-500 bg-blue-50/90 text-sm font-medium text-blue-700 dark:bg-blue-950/80 dark:text-blue-300"
    >
      <MdAttachFile className="h-5 w-5" />
      {t("attachments.dropToAttach")}
    </div>
  );
}

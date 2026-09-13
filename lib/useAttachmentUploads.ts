"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  attachmentKindOf,
  CHAT_ATTACHMENT_MAX_PER_MESSAGE,
  type AttachmentKind,
  type ChatAttachment,
} from "./chatAttachments";
import { getUploadLimit, isBlockedFile, uploadAttachment, type UploadLimit, type UploadTarget } from "./uploadApi";
import { translate } from "@/lib/i18n";

// The files waiting in a composer: each one starts uploading the moment it is
// picked, so by the time the message is written the file is usually already
// on the CDN and "send" has nothing left to wait for. Shared by the room chat,
// DMs and group rooms, which differ only in where the receipts are sent.

export interface PendingAttachment {
  id: number;
  name: string;
  size: number;
  kind: AttachmentKind;
  /** 0..1 of the bytes sent. */
  progress: number;
  status: "queued" | "uploading" | "done" | "error";
  error?: string;
  attachment?: ChatAttachment;
  /** The receipt the message carries — see the API's chatAttachments.ts. */
  token?: string;
}

// The API lets one person run three uploads at once; two leaves room for a
// second tab without anything being refused.
const MAX_PARALLEL = 2;

export function useAttachmentUploads(target: UploadTarget) {
  const [items, setItems] = useState<PendingAttachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState<UploadLimit | null>(null);
  // The same list as `items`, read by the queue below outside React's render.
  const itemsRef = useRef<PendingAttachment[]>([]);
  const files = useRef(new Map<number, File>());
  const controllers = useRef(new Map<number, AbortController>());
  const seq = useRef(0);

  const update = useCallback((next: (current: PendingAttachment[]) => PendingAttachment[]) => {
    itemsRef.current = next(itemsRef.current);
    setItems(itemsRef.current);
  }, []);

  const patch = useCallback(
    (id: number, changes: Partial<PendingAttachment>) =>
      update((current) => current.map((item) => (item.id === id ? { ...item, ...changes } : item))),
    [update]
  );

  // The queue calls itself again as each upload settles — through a ref, so
  // the callback that finishes is never an older copy of it.
  const pumpRef = useRef<() => void>(() => {});
  const pump = useCallback(() => {
    const running = itemsRef.current.filter((item) => item.status === "uploading").length;
    const waiting = itemsRef.current.filter((item) => item.status === "queued").slice(0, MAX_PARALLEL - running);
    for (const item of waiting) {
      const file = files.current.get(item.id);
      if (!file) continue;
      const controller = new AbortController();
      controllers.current.set(item.id, controller);
      patch(item.id, { status: "uploading" });
      void uploadAttachment(file, target, {
        signal: controller.signal,
        maxMb: limit?.maxMb ?? null,
        onProgress: (progress) => patch(item.id, { progress }),
      }).then((result) => {
        controllers.current.delete(item.id);
        files.current.delete(item.id);
        // Removed while it was running: nothing left to update.
        if (!itemsRef.current.some((entry) => entry.id === item.id)) return;
        if (result.ok) {
          patch(item.id, { status: "done", progress: 1, attachment: result.attachment, token: result.token });
        } else if (!result.aborted) {
          patch(item.id, { status: "error", error: result.error });
        }
        pumpRef.current();
      });
    }
  }, [limit?.maxMb, patch, target]);
  useEffect(() => {
    pumpRef.current = pump;
  }, [pump]);

  /** Asks the API how big a file may be. Called when the attach menu opens, so the menu can say. */
  const refreshLimit = useCallback(async () => {
    const value = await getUploadLimit();
    if (value) setLimit(value);
    return value;
  }, []);

  const add = useCallback(
    async (picked: File[]) => {
      if (picked.length === 0) return;
      setError(null);
      const current = await refreshLimit();
      if (!current) {
        setError(translate("attachments.couldNotSendTheFile"));
        return;
      }
      if (!current.available) {
        setError(translate("attachments.filesUnavailable"));
        return;
      }
      const room = CHAT_ATTACHMENT_MAX_PER_MESSAGE - itemsRef.current.length;
      if (room <= 0 || picked.length > room) {
        setError(translate("attachments.atMostFilesPerMessage", { max: CHAT_ATTACHMENT_MAX_PER_MESSAGE }));
        if (room <= 0) return;
      }
      const added: PendingAttachment[] = [];
      for (const file of picked.slice(0, Math.max(room, 0))) {
        if (isBlockedFile(file.name)) {
          setError(translate("attachments.fileTypeNotAllowed"));
          continue;
        }
        if (file.size > current.maxBytes) {
          setError(translate("attachments.fileTooLarge", { mb: current.maxMb }));
          continue;
        }
        if (file.size < current.minBytes) {
          setError(translate("attachments.fileTooSmall"));
          continue;
        }
        const id = (seq.current += 1);
        files.current.set(id, file);
        added.push({
          id,
          name: file.name,
          size: file.size,
          kind: attachmentKindOf(file.type),
          progress: 0,
          status: "queued",
        });
      }
      if (added.length === 0) return;
      update((list) => [...list, ...added]);
      pump();
    },
    [pump, refreshLimit, update]
  );

  /** Takes a file out of the tray, cancelling its upload if it is still going. */
  const remove = useCallback(
    (id: number) => {
      controllers.current.get(id)?.abort();
      controllers.current.delete(id);
      files.current.delete(id);
      update((list) => list.filter((item) => item.id !== id));
      setError(null);
      pump();
    },
    [pump, update]
  );

  /** Once the message has gone: the files are the message's now. */
  const clear = useCallback(() => {
    for (const controller of controllers.current.values()) controller.abort();
    controllers.current.clear();
    files.current.clear();
    update(() => []);
    setError(null);
  }, [update]);

  // A composer that goes away takes its unfinished uploads with it.
  useEffect(() => {
    const running = controllers.current;
    return () => {
      for (const controller of running.values()) controller.abort();
    };
  }, []);

  const uploading = items.some((item) => item.status === "queued" || item.status === "uploading");
  const failed = items.some((item) => item.status === "error");
  const done = items.filter((item) => item.status === "done" && item.token && item.attachment);

  return {
    items,
    add,
    remove,
    clear,
    error,
    setError,
    limit,
    refreshLimit,
    /** Something is still on its way to the CDN — "send" waits. */
    uploading,
    /** A file in the tray failed; it has to be removed before sending. */
    failed,
    /** The receipts to send with the message. */
    tokens: done.map((item) => item.token as string),
    /** What was uploaded, for drawing the message before the server echoes it. */
    attachments: done.map((item) => item.attachment as ChatAttachment),
  };
}

export type AttachmentUploads = ReturnType<typeof useAttachmentUploads>;

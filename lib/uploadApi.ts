"use client";

import { getAccountToken } from "./accountApi";
import type { ChatAttachment } from "./chatAttachments";
import { getStoredGuestToken } from "./guestToken";
import { getSignalingHttpBase } from "./roomsApi";
import { translate } from "@/lib/i18n";

// Putting a file on the CDN ahead of the message it goes out in (see the
// API's uploadRoutes.ts). The API answers with the file's description and a
// signed receipt; the message then carries the receipt, never a URL.
//
// XMLHttpRequest rather than fetch, for the one thing fetch still cannot do
// in every browser this app runs in: report upload progress. A 100 MB video
// with no bar is a frozen screen.

export type UploadTarget = "chat" | "dms" | "groups";

/** The token uploads are made with: the account's, or the guest's. */
export function uploadAuthToken(): string | null {
  return getAccountToken() ?? getStoredGuestToken();
}

export interface UploadLimit {
  maxBytes: number;
  maxMb: number;
  /** The CDN's floor — a smaller file cannot be stored as it is. */
  minBytes: number;
  available: boolean;
}

// Mirrors the API's BLOCKED_EXTENSIONS, so an .exe is refused in the picker
// instead of after it has travelled. The server does not trust this.
const BLOCKED_EXTENSIONS = new Set([
  "exe", "msi", "dll", "bat", "cmd", "com", "scr", "cpl", "pif", "hta", "vbs", "vbe",
  "jse", "wsf", "wsh", "msc", "reg", "lnk", "sys", "drv", "ps1", "apk", "xpi",
]);

export function isBlockedFile(name: string): boolean {
  const match = /\.([A-Za-z0-9]{1,12})$/.exec(name);
  return Boolean(match && BLOCKED_EXTENSIONS.has(match[1].toLowerCase()));
}

// A minute, keyed by token: long enough that picking five files asks once,
// short enough that a subscription bought a moment ago shows its new limit.
const LIMIT_TTL_MS = 60_000;
const limitCache = new Map<string, { at: number; value: Promise<UploadLimit | null> }>();

/** How big a file this person may attach, or null when it could not be asked. */
export function getUploadLimit(): Promise<UploadLimit | null> {
  const token = uploadAuthToken();
  if (!token) return Promise.resolve(null);
  const cached = limitCache.get(token);
  if (cached && Date.now() - cached.at < LIMIT_TTL_MS) return cached.value;
  const value = fetch(`${getSignalingHttpBase()}/uploads/limit`, {
    headers: { Authorization: `Bearer ${token}` },
  })
    .then(async (res) => (res.ok ? ((await res.json()) as UploadLimit) : null))
    .catch(() => null);
  limitCache.set(token, { at: Date.now(), value });
  // A failed ask is not remembered: the next pick tries again.
  void value.then((limit) => {
    if (!limit) limitCache.delete(token);
  });
  return value;
}

export type UploadResult =
  | { ok: true; attachment: ChatAttachment; token: string }
  | { ok: false; error: string; aborted?: boolean };

function errorFor(status: number, serverError: string | undefined, maxMb: number | null): string {
  if (status === 401) return translate("attachments.signInToSendFiles");
  if (status === 413) {
    return maxMb ? translate("attachments.fileTooLarge", { mb: maxMb }) : translate("attachments.couldNotSendTheFile");
  }
  if (status === 429) return translate("attachments.waitForTheOtherUploads");
  if (status === 503) return translate("attachments.filesUnavailable");
  if (status === 400 && serverError?.includes("cannot be sent")) return translate("attachments.fileTypeNotAllowed");
  if (status === 400 && serverError?.includes("too small")) return translate("attachments.fileTooSmall");
  return translate("attachments.couldNotSendTheFile");
}

export function uploadAttachment(
  file: File,
  target: UploadTarget,
  {
    onProgress,
    signal,
    maxMb = null,
  }: { onProgress?: (fraction: number) => void; signal?: AbortSignal; maxMb?: number | null } = {}
): Promise<UploadResult> {
  const token = uploadAuthToken();
  if (!token) return Promise.resolve({ ok: false, error: translate("attachments.signInToSendFiles") });

  return new Promise((resolve) => {
    const query = new URLSearchParams({ name: file.name, type: file.type || "application/octet-stream", for: target });
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${getSignalingHttpBase()}/uploads?${query.toString()}`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.responseType = "json";
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      const data = (xhr.response ?? null) as { attachment?: ChatAttachment; token?: string; error?: string } | null;
      if (xhr.status >= 200 && xhr.status < 300 && data?.attachment && data.token) {
        onProgress?.(1);
        resolve({ ok: true, attachment: data.attachment, token: data.token });
        return;
      }
      resolve({ ok: false, error: errorFor(xhr.status, data?.error, maxMb) });
    };
    xhr.onerror = () => resolve({ ok: false, error: translate("attachments.couldNotSendTheFile") });
    xhr.onabort = () => resolve({ ok: false, error: translate("attachments.uploadCancelled"), aborted: true });
    if (signal) {
      if (signal.aborted) {
        resolve({ ok: false, error: translate("attachments.uploadCancelled"), aborted: true });
        return;
      }
      signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }
    xhr.send(file);
  });
}

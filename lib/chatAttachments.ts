// Files attached to a message — videos, audio, documents. Pictures are not
// here: they still travel as `images` (see lib/chatImage.ts), downscaled and
// drawn inline in the log.
//
// Only types and small helpers, with no imports, so lib/signalingClient can
// use them without pulling in a feature module that imports it back. The
// network half is lib/uploadApi.ts.

export type AttachmentKind = "video" | "audio" | "file";

/** Mirrors the API's ChatAttachment (see its chatAttachments.ts). */
export interface ChatAttachment {
  url: string;
  name: string;
  size: number;
  type: string;
  kind: AttachmentKind;
}

/** Mirrors the API's CHAT_ATTACHMENT_MAX_PER_MESSAGE. */
export const CHAT_ATTACHMENT_MAX_PER_MESSAGE = 5;

export function attachmentKindOf(type: string): AttachmentKind {
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  return "file";
}

/** The attachments a message arrived with, checked field by field. */
export function parseAttachments(raw: unknown): ChatAttachment[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: ChatAttachment[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const value = entry as Record<string, unknown>;
    if (typeof value.url !== "string" || !value.url.startsWith("https://")) continue;
    const type = typeof value.type === "string" ? value.type : "application/octet-stream";
    out.push({
      url: value.url,
      name: typeof value.name === "string" && value.name ? value.name : "arquivo",
      size: typeof value.size === "number" && value.size > 0 ? value.size : 0,
      type,
      kind: value.kind === "video" || value.kind === "audio" || value.kind === "file" ? value.kind : attachmentKindOf(type),
    });
  }
  return out.length > 0 ? out : undefined;
}

/** "842 KB", "12,4 MB" — the size on a file's card. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value < 10 ? 1 : 0;
  return `${value.toFixed(digits).replace(".", ",")} ${units[unit]}`;
}

/** The extension, upper-cased, for the badge on a file's card: "PDF", "ZIP". */
export function fileExtension(name: string): string {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(name);
  return match ? match[1].toUpperCase() : "";
}

/** One line saying what a message's files are, for a reply's quote. */
export function attachmentsPreview(attachments: ChatAttachment[] | undefined): string {
  if (!attachments || attachments.length === 0) return "";
  const [first] = attachments;
  const more = attachments.length > 1 ? ` +${attachments.length - 1}` : "";
  return `📎 ${first.name}${more}`;
}

"use client";

import { useState } from "react";
import { MdCheck, MdContentCopy } from "react-icons/md";
import { copyText } from "@/lib/clipboard";
import { useT } from "@/lib/useI18n";

/**
 * The small clipboard icon beside a chat message, matching the reply button
 * it sits next to in ChatPanel/TextChannelView/DirectMessagesModal — same
 * size, same hover-to-reveal treatment, so a copy is as fast to reach as a
 * reply. Copies the message's raw text (markdown included), the same thing
 * that was actually typed, rather than a rendered/stripped version somebody
 * would have to reformat after pasting.
 *
 * Absent for a message with no text (a bare image or GIF) — there is nothing
 * here to copy, and an icon that does nothing is worse than no icon.
 */
export function CopyMessageButton({ text, className }: { text: string; className?: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  if (!text.trim()) return null;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void copyText(text).then((ok) => {
          if (!ok) return;
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      aria-label={t("common.copy")}
      title={copied ? t("common.copied") : t("common.copy")}
      className={className}
    >
      {copied ? <MdCheck className="h-3.5 w-3.5" /> : <MdContentCopy className="h-3.5 w-3.5" />}
    </button>
  );
}

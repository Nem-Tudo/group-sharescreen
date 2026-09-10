"use client";

import { useCallback, useState } from "react";
import { MdCheck, MdContentCopy, MdLink } from "react-icons/md";

// "Copiar link", with the one thing that makes a copy button trustworthy: it
// says whether it worked.
//
// The clipboard can refuse — an insecure origin, a permission denied, a
// browser that only allows it straight off a user gesture — and a button that
// looks identical whether it copied or not is worse than no button, because
// somebody pastes nothing into a conversation and blames the paste. So the
// failure is a state of its own, and it hands over the text to be selected by
// hand rather than pretending.

export function CopyButton({
  value,
  label = "Copiar link",
  copiedLabel = "Link copiado!",
  className,
  icon,
  compact,
}: {
  value: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
  icon?: "link" | "copy";
  /**
   * Icon alone, for a row that has no width to spare. The label survives as
   * the accessible name and the tooltip — it is the only thing telling anybody
   * what the icon means, so it is never dropped, only moved.
   */
  compact?: boolean;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const Icon = icon === "copy" ? MdContentCopy : MdLink;

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("failed");
    }
  }, [value]);

  if (state === "failed") {
    // Selectable and whole. Whoever gets here is going to copy it by hand, and
    // a truncated link is one they cannot.
    //
    // Even compact: an icon-sized apology is no use to somebody who now has to
    // read the link off the screen. It is a rare enough path that letting it
    // take the width it needs is the right trade — the rows it sits in wrap.
    return (
      <span className="flex min-w-0 flex-col gap-1">
        <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
          Copie o link à mão:
        </span>
        <code className="break-all rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-[11px] leading-snug text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
          {value}
        </code>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      // Both, and always: compact has no visible text at all, and even the
      // full one benefits — "Link copiado!" replaces the label for two
      // seconds, and a tooltip that still says what the button does is how
      // somebody knows it is the same button.
      aria-label={label}
      title={label}
      className={
        className ??
        "flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
      }
    >
      {state === "copied" ? (
        <MdCheck className="h-4 w-4 shrink-0 text-emerald-500" />
      ) : (
        <Icon className="h-4 w-4 shrink-0" />
      )}
      {!compact && (state === "copied" ? copiedLabel : label)}
    </button>
  );
}

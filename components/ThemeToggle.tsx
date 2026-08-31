"use client";

import { useState } from "react";
import { MdOutlineComputer, MdOutlineDarkMode, MdOutlineLightMode } from "react-icons/md";
import { Popover } from "@/components/Tooltip";
import { useTheme } from "@/lib/useTheme";
import { trackEvent } from "@/lib/analytics";
import type { ThemePreference } from "@/lib/theme";

// All three, always visible — a switch that only cycles hides what it will do
// next, and with "sistema" in the loop that is three unlabelled states to
// guess at. Order runs light → dark → system, which is also how they read.
const OPTIONS: {
  value: ThemePreference;
  label: string;
  Icon: typeof MdOutlineLightMode;
}[] = [
  { value: "light", label: "Claro", Icon: MdOutlineLightMode },
  { value: "dark", label: "Escuro", Icon: MdOutlineDarkMode },
  { value: "system", label: "Sistema", Icon: MdOutlineComputer },
];

// The segmented control itself. Used on its own inside the room's "Mais
// opções" panel, and as the body of the icon button below.
export function ThemeSegmented({ className = "" }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Tema do site"
      className={`flex items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-100 p-1 dark:border-zinc-800 dark:bg-zinc-900 ${className}`}
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => {
              setTheme(value);
              trackEvent("theme_changed", { theme: value });
            }}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition ${
              active
                ? "bg-white text-zinc-950 shadow-sm dark:bg-zinc-700 dark:text-zinc-50"
                : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </button>
        );
      })}
    </div>
  );
}

// The compact form, for a bar with no room for three labelled buttons (see
// components/SiteHeader.tsx): one icon showing what is on now, opening the
// same control above.
//
// The icon is the *resolved* theme, not the preference — on "sistema" what
// someone wants to see at a glance is which one they're actually looking at,
// and the open panel is where the distinction between "escuro" and "sistema,
// que agora está escuro" belongs.
export function ThemeMenuButton({ className = "" }: { className?: string }) {
  const { theme, resolvedTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const Icon = resolvedTheme === "dark" ? MdOutlineDarkMode : MdOutlineLightMode;
  const label =
    theme === "system"
      ? `Tema: sistema (${resolvedTheme === "dark" ? "escuro" : "claro"})`
      : theme === "dark"
        ? "Tema: escuro"
        : "Tema: claro";

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      placement="bottom-end"
      // Popover's own hint rather than a <Tooltip> wrapped around the button:
      // both tippys attach to the same node, and nesting them leaves the
      // outer one with nothing to anchor to (see Tooltip.tsx).
      tooltip={label}
      content={
        <div className="w-65 max-w-[calc(100vw-1rem)] rounded-xl border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
          <p className="mb-1.5 px-1 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
            Tema
          </p>
          <ThemeSegmented />
        </div>
      }
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        className={`inline-flex items-center justify-center rounded-lg p-1.5 transition ${
          open
            ? "bg-zinc-200/70 text-zinc-950 dark:bg-zinc-800 dark:text-zinc-50"
            : "text-zinc-500 hover:bg-zinc-200/60 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
        } ${className}`}
      >
        <Icon className="h-4.5 w-4.5" />
      </button>
    </Popover>
  );
}

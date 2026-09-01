"use client";

// A single control for the whole notification story, driven by
// useNotifications. It renders differently for each state because each state
// has a different next action:
//
//   default  → a bell with a "+" feel: click asks the browser for permission.
//   granted  → a lit bell: click mutes (locally, without revoking permission).
//   muted    → a struck-through bell: click un-mutes.
//   denied   → a struck-through, disabled bell: the browser blocked it and only
//              the user can undo that in site settings, so we say so and stop.
//
// Unsupported environments render nothing at all — an inert bell is worse than
// no bell. Reusable anywhere a "manage notifications" affordance belongs; the
// chat header is just its first home.

import { Tooltip } from "./Tooltip";
import { useNotifications } from "@/lib/useNotifications";

export function NotificationBell({ className = "" }: { className?: string }) {
  const { supported, permission, muted, enable, setMuted } = useNotifications();

  if (!supported) return null;

  const struck = permission === "denied" || (permission === "granted" && muted);
  const disabled = permission === "denied";

  const tooltip =
    permission === "denied"
      ? "Notificações bloqueadas nas configurações do navegador"
      : permission === "default"
        ? "Ativar notificações"
        : muted
          ? "Notificações silenciadas — clique para ativar"
          : "Notificações ativas — clique para silenciar";

  function onClick() {
    if (permission === "default") {
      void enable();
    } else if (permission === "granted") {
      setMuted(!muted);
    }
  }

  return (
    <Tooltip content={tooltip}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={tooltip}
        aria-pressed={permission === "granted" && !muted}
        className={`relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 ${
          permission === "granted" && !muted ? "text-blue-500 dark:text-blue-400" : ""
        } ${className}`}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
          aria-hidden
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          {struck && <line x1="3" y1="3" x2="21" y2="21" className="text-red-500" stroke="currentColor" />}
        </svg>
      </button>
    </Tooltip>
  );
}

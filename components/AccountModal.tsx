"use client";

import { CreateAccountForm } from "@/components/CreateAccountForm";
import { LoginForm } from "@/components/LoginForm";

// The "entrar / criar conta" dialog, in one place.
//
// It lived inline in WatchRoom, which was fine while a room was the only
// screen that ever asked somebody to sign in. The premium page asks too, and
// a second copy of a dialog is a second copy of every decision inside it —
// the backdrop click, the stopPropagation that keeps a click on the card from
// closing it, which heading goes with which form, how switching between the
// two works. Those would have drifted, and the one that drifted would have
// been whichever screen was touched less.

export type AccountModalMode = "login" | "create";

export function AccountModal({
  mode,
  onModeChange,
  initialDisplayName = "",
}: {
  /** Which form to show, or null for closed. */
  mode: AccountModalMode | null;
  /** Called with a new mode to switch forms, or null to close. */
  onModeChange: (mode: AccountModalMode | null) => void;
  /**
   * Pre-fills the display name — a room already knows what the person is
   * calling themselves, and making them type it again to keep it would be
   * asking for something already on screen behind the dialog.
   */
  initialDisplayName?: string;
}) {
  if (!mode) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={() => onModeChange(null)}
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-black/10 bg-white p-8 shadow-xl dark:border-white/10 dark:bg-zinc-950"
        // Without this, a click anywhere inside the card bubbles to the
        // backdrop above and closes the dialog — including a click on a text
        // field, which is how a form becomes impossible to fill in.
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          {mode === "login" ? "Entrar na conta" : "Criar conta"}
        </h2>
        {mode === "login" ? (
          <LoginForm
            onCancel={() => onModeChange(null)}
            onSuccess={() => onModeChange(null)}
            onSwitchToCreate={() => onModeChange("create")}
          />
        ) : (
          <CreateAccountForm
            initialDisplayName={initialDisplayName}
            onCancel={() => onModeChange(null)}
            onSuccess={() => onModeChange(null)}
            onSwitchToLogin={() => onModeChange("login")}
          />
        )}
      </div>
    </div>
  );
}

"use client";

import { useSyncExternalStore } from "react";
import { UserProfileDialog } from "@/components/UserProfileDialog";

// One profile dialog for the whole group screen. Anything that shows a person —
// a message's author, somebody in a voice room, a row in the members column —
// calls openGroupProfile, and the single GroupProfileHost in the shell draws
// the dialog. One host rather than a dialog per list, so opening someone from
// one place never leaves a second copy behind in another.

export interface GroupProfileTarget {
  id: string;
  name: string;
  avatarUrl: string | null;
  /** Guests have no profile to fetch; the dialog draws one from name and picture. */
  guest: boolean;
}

let current: GroupProfileTarget | null = null;
const listeners = new Set<() => void>();

function setCurrent(next: GroupProfileTarget | null) {
  current = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function openGroupProfile(target: GroupProfileTarget): void {
  setCurrent(target);
}

export function GroupProfileHost() {
  const target = useSyncExternalStore(subscribe, () => current, () => null);
  if (!target) return null;
  return (
    <UserProfileDialog
      key={target.id}
      userId={target.id}
      guest={target.guest ? { name: target.name, avatarUrl: target.avatarUrl } : undefined}
      onClose={() => setCurrent(null)}
    />
  );
}

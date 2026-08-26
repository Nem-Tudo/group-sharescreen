"use client";

import type { ComponentType, ReactNode } from "react";
import { useSyncExternalStore } from "react";
import { NtPopupProvider } from "ntpopups";
import "ntpopups/dist/styles.css";
import { PartnerRewardModal } from "@/components/PartnerRewardModal";
import { AddVideoSourceModal } from "@/components/AddVideoSourceModal";
import { ManageRoomModal } from "@/components/ManageRoomModal";

// Popup types this app registers with the library, opened by name through
// `useNtPopups().openPopup(...)`. The cast is because the library types
// `customPopups` as a map of prop-less components; each popup component
// actually receives `closePopup`/`popupstyles`/`data` from the library
// itself, which it can't express here.
const customPopups: Record<string, ComponentType> = {
  partner_reward: PartnerRewardModal as ComponentType,
  add_video_source: AddVideoSourceModal as ComponentType,
  manage_room: ManageRoomModal as ComponentType,
};

// Matches the rest of the app, which themes purely off the OS preference
// (Tailwind's `dark:` with no class toggle anywhere — see globals.css).
// useSyncExternalStore rather than an effect so the server render has a
// defined answer ("white") and the client corrects it during hydration
// instead of after a paint.
function usePrefersDark(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia("(prefers-color-scheme: dark)");
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
    () => false
  );
}

// Mounted once in app/layout.tsx, inside AuthProvider — the popups it renders
// (the partner reward video, for one) use the account. It renders nothing at
// all until something opens a popup.
export function NtPopups({ children }: { children: ReactNode }) {
  const prefersDark = usePrefersDark();

  return (
    <NtPopupProvider
      language="ptbr"
      theme={prefersDark ? "dark" : "white"}
      customPopups={customPopups}
    >
      {children}
    </NtPopupProvider>
  );
}

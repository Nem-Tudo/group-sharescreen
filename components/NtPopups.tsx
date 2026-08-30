"use client";

import type { ComponentType, ReactNode } from "react";
import { NtPopupProvider } from "ntpopups";
import { useResolvedTheme } from "@/lib/useTheme";
import "ntpopups/dist/styles.css";
import { PartnerRewardModal } from "@/components/PartnerRewardModal";
import { AddVideoSourceModal } from "@/components/AddVideoSourceModal";
import { ManageRoomModal } from "@/components/ManageRoomModal";
import { AddMusicSourceModal } from "@/components/AddMusicSourceModal";
import { MemberActionsModal } from "@/components/MemberActionsModal";

// Popup types this app registers with the library, opened by name through
// `useNtPopups().openPopup(...)`. The cast is because the library types
// `customPopups` as a map of prop-less components; each popup component
// actually receives `closePopup`/`popupstyles`/`data` from the library
// itself, which it can't express here.
const customPopups: Record<string, ComponentType> = {
  partner_reward: PartnerRewardModal as ComponentType,
  add_video_source: AddVideoSourceModal as ComponentType,
  manage_room: ManageRoomModal as ComponentType,
  add_music_source: AddMusicSourceModal as ComponentType,
  member_actions: MemberActionsModal as ComponentType,
};

// Mounted once in app/layout.tsx, inside AuthProvider — the popups it renders
// (the partner reward video, for one) use the account. It renders nothing at
// all until something opens a popup.
export function NtPopups({ children }: { children: ReactNode }) {
  // The theme the person actually chose, not the OS preference this used to
  // read directly — with a switch in the UI (see lib/theme.ts) those are two
  // different things, and a popup opening in the opposite theme to the page
  // behind it is the most visible place that could go wrong. Still backed by
  // useSyncExternalStore, so the server render has a defined answer ("white")
  // and the client corrects it during hydration rather than after a paint.
  const resolvedTheme = useResolvedTheme();

  return (
    <NtPopupProvider
      language="ptbr"
      theme={resolvedTheme === "dark" ? "dark" : "white"}
      customPopups={customPopups}
    >
      {children}
    </NtPopupProvider>
  );
}

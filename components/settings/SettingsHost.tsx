"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { AccountModal, type AccountModalMode } from "@/components/AccountModal";
import { closeSettings, useSettingsWindow } from "@/lib/settingsHub";
import { signalingClient } from "@/lib/signalingClient";

// The "Configurações" dialog, mounted once at the root so any screen can open
// it without leaving where it is (see lib/settingsHub). A chunk of its own: it
// pulls in every setting on the site, and most visits never open it.
const SettingsDialog = dynamic(
  () => import("@/components/settings/SettingsDialog").then((m) => m.SettingsDialog),
  { ssr: false }
);

export function SettingsHost() {
  const { open } = useSettingsWindow();
  const [accountModal, setAccountModal] = useState<AccountModalMode | null>(null);

  return (
    <>
      {open && (
        <SettingsDialog
          onRequestAccount={(mode) => {
            closeSettings();
            setAccountModal(mode);
          }}
        />
      )}
      <AccountModal
        mode={accountModal}
        onModeChange={setAccountModal}
        initialDisplayName={accountModal ? signalingClient.getSnapshot().name ?? "" : ""}
      />
    </>
  );
}

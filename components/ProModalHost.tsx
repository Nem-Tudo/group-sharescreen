"use client";

import { ProModal } from "@/components/ProModal";
import { closeProModal, useProModal } from "@/lib/proModal";

// Mounted at the layout root (RootLayout) so any "Pro" button in the application
// can open the Pro modal directly without navigating away from the current room or page.

export function ProModalHost() {
  const { open, planId } = useProModal();
  return <ProModal open={open} planId={planId} onClose={closeProModal} />;
}


"use client";

import { DirectMessagesModal } from "@/components/DirectMessagesModal";
import { closeDirectMessages, useDirectMessagesWindow } from "@/lib/dmWindow";

// The one conversation window on the page.
//
// Mounted at the layout root rather than beside any of the buttons that open
// it: those live in two different headers and in profile cards, and a dialog
// per opener would be several conversations of the same thread, each with its
// own scroll and its own idea of what has been read.
export function DirectMessagesHost() {
  const { open, withUserId } = useDirectMessagesWindow();
  return (
    <DirectMessagesModal open={open} onClose={closeDirectMessages} openWith={withUserId} />
  );
}

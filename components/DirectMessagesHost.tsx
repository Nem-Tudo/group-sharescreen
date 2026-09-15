"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { DirectMessagesModal } from "@/components/DirectMessagesModal";
import { dmPath, parseGroupsPath } from "@/lib/groupLinks";
import { useGroupNavigation } from "@/lib/groupNavigation";
import {
  closeDirectMessages,
  registerDirectMessagesNavigator,
  syncDirectMessagesWithPath,
  useDirectMessagesWindow,
} from "@/lib/dmWindow";
import { LG_BREAKPOINT_QUERY } from "@/lib/useMediaQuery";

function onDmPage(): boolean {
  return parseGroupsPath(window.location.pathname)?.kind === "dms";
}

// The one conversation window on the page.
//
// Mounted at the layout root rather than beside any of the buttons that open
// it: those live in two different headers and in profile cards, and a dialog
// per opener would be several conversations of the same thread, each with its
// own scroll and its own idea of what has been read.
//
// It also ties the expanded window to its own address (see lib/dmWindow's
// navigator): the store moves the address, and the address moves the store.
export function DirectMessagesHost() {
  const { open, withUserId, expanded } = useDirectMessagesWindow();
  const pathname = usePathname();
  const navigation = useGroupNavigation();
  // The page the messages were expanded from, to go back to when they close.
  const returnTo = useRef<string | null>(null);

  useEffect(
    () =>
      registerDirectMessagesNavigator({
        wide: () => window.matchMedia(LG_BREAKPOINT_QUERY).matches,
        onDmPage,
        show: (userId) => {
          const href = dmPath(userId);
          // Moving between threads is not a trail of history entries.
          if (onDmPage()) {
            navigation.replace(href);
            return;
          }
          returnTo.current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
          navigation.push(href);
        },
        leave: () => {
          const href = returnTo.current ?? "/groups";
          returnTo.current = null;
          navigation.push(href);
        },
      }),
    [navigation]
  );

  const route = parseGroupsPath(pathname);
  // "" stands for the list, so the effect only runs when the address changes.
  const dmKey = route?.kind === "dms" ? route.withUserId ?? "" : null;
  useEffect(() => {
    syncDirectMessagesWithPath(dmKey === null ? undefined : dmKey || null);
  }, [dmKey]);

  return (
    <DirectMessagesModal
      open={open}
      onClose={closeDirectMessages}
      openWith={withUserId}
      expanded={expanded}
    />
  );
}

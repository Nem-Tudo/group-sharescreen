"use client";

import { createContext, useContext, useMemo } from "react";
import { useRouter } from "next/navigation";
import { parseGroupsPath } from "./groupLinks";

// Moving around inside /groups without asking the server.
//
// Every page under /groups is a thin wrapper around client components that
// read the groups store (lib/useGroups) — there is nothing for the server to
// render. But /groups/[groupId]/[roomId] is a dynamic route, and a Next
// navigation to one waits for the server to render its payload: that round
// trip was the whole of the second or two a room switch took, for a page that
// comes back empty.
//
// So the shell (components/groups/GroupAppShell) draws whichever view the URL
// names itself, and moving between them is `history.pushState` — which Next
// folds into its router, so `usePathname` follows along and back/forward
// restore the entry without a fetch (see Next's "Shallow routing on the
// client"). The URL stays the real one: a reload, a shared link or a new tab
// lands on the same room through the ordinary file-system route.
//
// `useParams` does *not* follow a pushState — it is derived from the route
// tree the server last sent, which no longer changes — so anything that needs
// the current group or room reads it off the path (groupLinks' parseGroupsPath).

// Whether a shell is there to draw the new path. Shallow navigation is only
// right while one is: from anywhere else (the home page, an invite) nothing is
// listening, and a real navigation is what has to happen.
//
// Asked two ways, because each misses a case the other covers. The page the
// shell draws is wrapped in the context, and has to be: React runs a child's
// effects before its parent's, so GroupIndex's redirect to the last room runs
// before the shell has registered below. Everything else (the sidebar's
// clicks, a popup mounted at the root, the push-notification handler) moves
// after the shell is up, and the count answers for it.
export const GroupShellContext = createContext(false);
let mountedShells = 0;

/** Called by the shell on mount; returns the matching unmount. */
export function registerGroupShell(): () => void {
  mountedShells += 1;
  return () => {
    mountedShells -= 1;
  };
}

function canNavigateInShell(href: string, inShell: boolean): boolean {
  if (typeof window === "undefined" || (!inShell && mountedShells === 0)) return false;
  return parseGroupsPath(href) !== null && parseGroupsPath(window.location.pathname) !== null;
}

function currentHref(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

/**
 * Navigation for anything under /groups: shallow while the shell is there to
 * draw it, an ordinary Next navigation otherwise. Same shape as the router's
 * push/replace, so it drops in where those were.
 */
export function useGroupNavigation(): { push: (href: string) => void; replace: (href: string) => void } {
  const router = useRouter();
  const inShell = useContext(GroupShellContext);
  return useMemo(
    () => ({
      push(href: string) {
        if (!canNavigateInShell(href, inShell)) {
          router.push(href);
          return;
        }
        // Clicking the room you are in is not a new history entry.
        if (href !== currentHref()) window.history.pushState(null, "", href);
      },
      replace(href: string) {
        if (!canNavigateInShell(href, inShell)) {
          router.replace(href);
          return;
        }
        if (href !== currentHref()) window.history.replaceState(null, "", href);
      },
    }),
    [router, inShell]
  );
}

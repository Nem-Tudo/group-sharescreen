"use client";

import { useEffect } from "react";
import useNtPopups from "ntpopups";
import { AddBotClient } from "@/components/bots/AddBotClient";
import { SITE_URL } from "@/lib/seo";

// "Adicionar a um grupo", as a dialog over wherever it was pressed — the bot's
// profile, a bot's card, a link somebody pasted in a chat — instead of a page
// that takes you away from it. The card is the add page's own (AddBotClient);
// /bots/:id/add still exists, for a link opened from outside the site.

export type AddBotPopupData = { botId: string };

export function AddBotDialog({
  closePopup,
  data,
}: {
  closePopup: (hasAction?: boolean) => void;
  data?: AddBotPopupData;
}) {
  return <AddBotClient botId={data?.botId ?? ""} variant="dialog" onClose={() => closePopup(false)} />;
}

const ADD_PATH_RE = /^\/bots\/([^/]+)\/add\/?$/;

/** The hosts a link has to be on to be the site's own add page. */
function isSiteHost(host: string): boolean {
  if (host === window.location.host) return true;
  try {
    return host === new URL(SITE_URL).host;
  } catch {
    return false;
  }
}

/**
 * Turns every click on a link to a bot's add page into the dialog — one
 * listener for the whole app rather than a handler on each such link, so the
 * ones inside a chat message, a DM or a bot's bio are caught as well.
 *
 * On the document, in the capture phase: before the link's own handlers, so
 * marking the click handled is what stops Next's <Link> from navigating (it
 * checks for that). A click meant for a new tab — modifier keys, the middle
 * button — is left alone, and so is the add page itself.
 */
export function BotAddLinkInterceptor() {
  const { openPopup } = useNtPopups();

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as Element | null)?.closest?.("a[href]");
      const href = anchor?.getAttribute("href");
      if (!href) return;
      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (!isSiteHost(url.host)) return;
      const match = ADD_PATH_RE.exec(url.pathname);
      if (!match || window.location.pathname === url.pathname) return;
      e.preventDefault();
      const botId = decodeURIComponent(match[1]);
      // After the click's own handlers — one of which may be closing the
      // dialog the link sat in (a bot's card, a profile) — so that closing is
      // not taken for closing this one.
      setTimeout(() => void openPopup("add_bot", { data: { botId } }), 0);
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [openPopup]);

  return null;
}

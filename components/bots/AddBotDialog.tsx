"use client";

import { useEffect } from "react";
import useNtPopups from "ntpopups";
import { AddBotClient } from "@/components/bots/AddBotClient";
import { InviteClient } from "@/components/groups/InviteClient";
import { inviteCodeFromInput, isInviteCode } from "@/lib/groupLinks";
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

/** A group's invite, as a dialog — the invite page's own card (see InviteClient). */
export type InvitePopupData = { code: string };

export function InviteDialog({
  closePopup,
  data,
}: {
  closePopup: (hasAction?: boolean) => void;
  data?: InvitePopupData;
}) {
  return <InviteClient code={data?.code ?? ""} variant="dialog" onClose={() => closePopup(false)} />;
}

const ADD_PATH_RE = /^\/bots\/([^/]+)\/add\/?$/;
const INVITE_PATH_RE = /^\/invite\/([^/]+)\/?$/;

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
 * Turns every click on a link to a bot's add page, or to a group's invite,
 * into its dialog — one
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
      if (window.location.pathname === url.pathname && window.location.host === url.host) return;
      let open: (() => void) | null = null;
      const addMatch = isSiteHost(url.host) ? ADD_PATH_RE.exec(url.pathname) : null;
      if (addMatch) {
        const botId = decodeURIComponent(addMatch[1]);
        open = () => void openPopup("add_bot", { data: { botId } });
      } else {
        // The site's own invite path, or any host an invite link is made on
        // (the short one included — see inviteCodeFromInput).
        const inviteMatch = isSiteHost(url.host) ? INVITE_PATH_RE.exec(url.pathname) : null;
        const code = inviteMatch && isInviteCode(inviteMatch[1]) ? inviteMatch[1] : inviteCodeFromInput(url.href);
        if (code) open = () => void openPopup("join_invite", { data: { code } });
      }
      if (!open) return;
      e.preventDefault();
      // After the click's own handlers — one of which may be closing the
      // dialog the link sat in (a bot's card, a profile) — so that closing is
      // not taken for closing this one.
      setTimeout(open, 0);
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [openPopup]);

  return null;
}

"use client";

import { useEffect } from "react";
import { notFound } from "next/navigation";
import { useDiscordBotHidden } from "@/lib/discordBotHidden";

// Was a redirect in next.config; a page now so the hide-discord-bot experiment
// can answer 404 instead.
const BOT_INVITE_URL = "https://discord.com/oauth2/authorize?client_id=1540460243270635600";

export default function BotInvitePage() {
  const { hidden, ready } = useDiscordBotHidden(true);
  useEffect(() => {
    if (ready && !hidden) window.location.replace(BOT_INVITE_URL);
  }, [ready, hidden]);
  if (hidden) notFound();
  return null;
}

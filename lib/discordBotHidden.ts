"use client";

import { useFeature } from "./features";

// Experiment: GoLive without the Discord bot. On the treatment side every link
// to it disappears (header, Você screen, home footer) and /discord-bot and
// /bot answer with the 404 page. Decided on the client, so the server render
// can't know the answer: nothing bot-related is shown until the decision is
// in (`show`), so the treatment side never sees a link blink away.
export const HIDE_DISCORD_BOT_FEATURE = "hide-discord-bot";

export function useDiscordBotHidden(track = false) {
  const { enabled, ready } = useFeature(HIDE_DISCORD_BOT_FEATURE, { track });
  return { hidden: enabled, ready, show: ready && !enabled };
}

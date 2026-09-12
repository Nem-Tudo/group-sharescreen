import type { Metadata } from "next";
import { ogImage } from "@/lib/seo";
import { translate } from "@/lib/i18n";
import { DiscordBotContent, DESCRIPTION, SITE_URL } from "./DiscordBotContent";

const TITLE = translate("discordBot.goliveBotForDiscordAnAutomatic");

const OG_IMAGE = ogImage({
  get title() { return translate("discordBot.goliveInYourDiscord"); },
  get subtitle() { return translate("discordBot.createRoomsAndCallPeopleWithout"); },
  get badge() { return translate("common.discordBot"); },
});

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "bot discord transmitir tela",
    "bot golive discord",
    "compartilhar tela no discord",
    "bot antijanja",
    translate("discordBot.screenSharingInADiscordCall"),
    translate("discordBot.broadcastRoomBot"),
    "alternativa ao go live do discord",
  ],
  alternates: { canonical: "/discord-bot" },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    url: `${SITE_URL}/discord-bot`,
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: TITLE }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [OG_IMAGE],
  },
  robots: { index: true, follow: true },
};

export default function Page() {
  return <DiscordBotContent />;
}

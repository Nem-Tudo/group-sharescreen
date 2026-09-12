import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { StatusBanner } from "@/components/StatusBanner";
import { AnnouncementBanner } from "@/components/AnnouncementBanner";
import { CapacitorBridge } from "@/components/CapacitorBridge";
import { InstallAppButton } from "@/components/InstallAppButton";
import { AuthProvider } from "@/lib/AuthContext";
import { PresenceReporter } from "@/components/PresenceReporter";
import { SocialNotifier } from "@/components/SocialNotifier";
import { GiftNotifier } from "@/components/GiftNotifier";
import { ThemeLikeNotifier } from "@/components/ThemeLikeNotifier";
import { GiftClaimHost } from "@/components/GiftClaimHost";
import { DmNotifier } from "@/components/DmNotifier";
import { GroupNotifier } from "@/components/GroupNotifier";
import { DirectMessagesHost } from "@/components/DirectMessagesHost";
import { CallHost } from "@/components/CallHost";
import { RoomCallHost } from "@/components/RoomCallHost";
import { PushRegistrar } from "@/components/PushRegistrar";
import { ProModalHost } from "@/components/ProModalHost";
import { NtPopups } from "@/components/NtPopups";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import { LOCALE_INIT_SCRIPT } from "@/lib/i18n";
import { I18nGate } from "@/components/I18nGate";
import { CHUNK_RECOVERY_SCRIPT } from "@/lib/chunkRecovery";
import "./globals.css";
import SupressErrors from "./middlewares/SupressErrors";
import { translate } from "@/lib/i18n";

const UMAMI_WEBSITE_ID = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

const SITE_URL = "https://golive.nemtudo.me";
const SITE_NAME = translate("common.golive");
const TITLE = translate("common.goliveFreeOnlineGroupScreenSharing");
const DESCRIPTION =
  translate("layout.broadcastYourVoiceScreenOrCamera");

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: `%s | ${SITE_NAME}`,
  },
  description: DESCRIPTION,
  keywords: [
    "transmitir tela",
    translate("layout.onlineScreenSharing"),
    "transmitir tela em grupo",
    translate("layout.easyOnlineGroupScreenSharing"),
    "compartilhar tela online",
    "compartilhamento de tela em grupo",
    "compartilhar tela com amigos",
    "assistir tela em grupo",
    "sala de compartilhamento de tela",

    translate("layout.streamCamera"),
    translate("layout.onlineCameraStreaming"),
    translate("layout.streamCameraAsAGroup"),
    translate("layout.easyOnlineGroupCameraStreaming"),
    translate("layout.shareCameraOnline"),
    translate("layout.groupCameraSharing"),
    translate("layout.shareCameraWithFriends"),
    translate("layout.watchACameraAsAGroup"),
    translate("layout.cameraSharingRoom"),

    "transmitir voz",
    translate("layout.onlineVoiceStreaming"),
    "transmitir voz em grupo",
    translate("layout.easyOnlineGroupVoiceStreaming"),
    "compartilhar voz online",
    "compartilhamento de voz em grupo",
    "compartilhar voz com amigos",
    "assistir voz em grupo",
    "sala de compartilhamento de voz",

    translate("layout.freeOnlineScreenShare"),
    translate("common.golive"),
    translate("layout.antijanja")
  ],
  applicationName: SITE_NAME,
  authors: [{ get name() { return translate("layout.nemtudo"); }, url: "https://discord.gg/nemtudo" }],
  get creator() { return translate("layout.nemtudo"); },
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: TITLE,
    description: DESCRIPTION,
    images: [
      {
        // A static file under public/, not the generated route that used to
        // live at app/opengraph-image.tsx. That file was deleted along with
        // this change: Next's file convention emits its own og:image for the
        // root segment, so leaving it would have put two images on every
        // shared link and let the crawler pick.
        url: "/assets/oembed/image.png",
        width: 1200,
        height: 630,
        get alt() { return translate("layout.goliveOnlineGroupScreenSharing"); },
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/assets/oembed/image.png"],
  },
  icons: {
    icon: "/icon.png",
    apple: "/icon.png",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
    },
  },
  // Links app/manifest.ts (served at /manifest.webmanifest) into <head> —
  // Next doesn't do that automatically just from the file existing, see its
  // own doc comment. Together with the `viewport` export below and
  // InstallAppButton, this is what makes "Adicionar à tela de início" open
  // GoLive full-screen/chrome-less (Android's PWA install, iOS's "Add to
  // Home Screen") instead of as a regular bookmark.
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: SITE_NAME,
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Makes the on-screen keyboard shrink the layout viewport (and with it
  // every dvh unit) instead of sliding the page up behind it. The room is a
  // fixed-height app shell on a phone — see WatchRoom and globals.css's
  // [data-room-shell] rule — so with the default the keyboard would cover
  // the chat composer that opened it and there would be nowhere to scroll
  // to; with this the whole shell simply becomes as tall as what is left.
  interactiveWidget: "resizes-content",
  // Matches manifest.ts's background_color/theme_color — themeColor moved
  // out of `metadata` and into this separate export (metadata.themeColor is
  // deprecated).
  themeColor: "#09090b",
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: SITE_NAME,
  url: SITE_URL,
  description: DESCRIPTION,
  applicationCategory: "CommunicationApplication",
  operatingSystem: "Any (navegador web)",
  inLanguage: "en",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "BRL",
  },
};


export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      // English, because that is what the server renders: a browser's
      // language is not knowable here, so LOCALE_INIT_SCRIPT corrects this
      // attribute before paint and I18nGate swaps the words after hydration.
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // The script below stamps data-theme/color-scheme onto this element
      // before React hydrates, which is by definition a difference from what
      // the server sent — and the point of doing it there rather than in an
      // effect (see THEME_INIT_SCRIPT).
      suppressHydrationWarning
    >
      <body className="h-full flex flex-col">
        {/* First thing in the document, and a plain <script> rather than
            next/script: it has to run before the browser paints anything, and
            every next/script strategy is either later than that or moves it
            somewhere it can't be. Blocking here costs a few hundred bytes of
            parse time and buys never showing a white flash to someone who
            chose the dark theme. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {/* Same reasoning as the theme script above, for <html lang>: a
            screen reader picks its voice from that attribute, and waiting for
            React would mean reading the first paint in the wrong accent. */}
        <script dangerouslySetInnerHTML={{ __html: LOCALE_INIT_SCRIPT }} />
        {/* Before anything else that could fail, because what it listens for
            is exactly the bundle failing to arrive — see lib/chunkRecovery.ts.
            Inline for the same reason the theme script above is: it has to
            work in the one situation where none of the app's own code runs. */}
        <script dangerouslySetInnerHTML={{ __html: CHUNK_RECOVERY_SCRIPT }} />
        <Script
          id="jsonld-webapplication"
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {/* Everything the app renders sits under this, because a language
            change has to reach all of it at once — see components/I18nGate. */}
        <I18nGate>
          <SupressErrors>
            <AuthProvider>
              <NtPopups>
                <CapacitorBridge />
                <PresenceReporter />
                {/* Renders nothing; it is the thing that fills the bell. At the
                    root because a friend request arrives whenever it arrives —
                    a bell that only filled up inside a room would be empty
                    exactly when somebody opens it. */}
                <SocialNotifier />
                {/* Same job, for the one thing that lands on an account without
                    its owner having done anything — a plan somebody bought
                    them. */}
                <GiftNotifier />
                {/* And for somebody liking a theme this account made. */}
                <ThemeLikeNotifier />
                {/* Opens the present somebody arrived holding — see /gift/[code],
                    which redirects here with the code on the URL. */}
                <GiftClaimHost />
                <DmNotifier />
                {/* Same job for group messages somebody asked to hear about. */}
                <GroupNotifier />
                {/* The one conversation window on the page — see its own comment. */}
                <DirectMessagesHost />
                {/* The ringing screen, both directions. At the root for the same
                    reason the bell is: a call arrives whenever it arrives, and
                    it has to be answerable from whatever page somebody is on. */}
                <CallHost />
                {/* The call itself — the one room there is, mounted here so it
                    survives every navigation. The page it belongs to only says
                    where to draw it (see components/RoomCallHost). */}
                <RoomCallHost />
                {/* Renders nothing; it is what makes a notification arrive with
                    the app closed — see components/PushRegistrar.tsx. */}
                <PushRegistrar />
                {/* GoLive Pro subscription modal */}
                <ProModalHost />
                {/* Above the announcement bar: this one says why nothing is
                    working, and the admin's message of the day is only worth
                    reading after that. See StatusBanner — it renders nothing
                    unless the status feed reports an outage. */}
                <StatusBanner />
                <AnnouncementBanner />
                {children}
                <InstallAppButton />
              </NtPopups>
            </AuthProvider>
          </SupressErrors>
        </I18nGate>
        {UMAMI_WEBSITE_ID && (
          <Script
            // src="/api/umami/script.js"
            src={`${process.env.UMAMI_URL}/script.js`}
            data-website-id={UMAMI_WEBSITE_ID}
            strategy="afterInteractive"
          />
        )}
        {TURNSTILE_SITE_KEY && (
          // Loaded here rather than on demand purely for latency: the first
          // thing most people do is join a room, and that is captcha-gated, so
          // fetching this at the same time as the page saves a round trip in
          // front of the button they are about to press. lib/turnstile.ts
          // injects the same tag itself if it is somehow not here yet, which is
          // what keeps that file usable from anywhere.
          //
          // ?render=explicit stops the script hunting the document for
          // containers to draw into: every widget in this app is created on
          // demand, one per gated action, and is invisible unless Cloudflare
          // decides that person needs to interact — see lib/turnstile.ts.
          <Script
            src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
            strategy="afterInteractive"
          />
        )}
      </body>
    </html>
  );
}

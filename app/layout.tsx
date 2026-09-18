import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { StatusBanner } from "@/components/StatusBanner";
import { AnnouncementBanner } from "@/components/AnnouncementBanner";
import { CapacitorBridge } from "@/components/CapacitorBridge";
import { LastScreenRestorer } from "@/components/LastScreenRestorer";
import { InstallAppButton } from "@/components/InstallAppButton";
import { MobileTabBar } from "@/components/MobileTabBar";
import { AuthProvider } from "@/lib/AuthContext";
import { PresenceReporter } from "@/components/PresenceReporter";
import { SocialNotifier } from "@/components/SocialNotifier";
import { GiftNotifier } from "@/components/GiftNotifier";
import { ThemeLikeNotifier } from "@/components/ThemeLikeNotifier";
import { GiftClaimHost } from "@/components/GiftClaimHost";
import { DmNotifier } from "@/components/DmNotifier";
import { DesktopUnreadFlash } from "@/components/DesktopUnreadFlash";
import { GroupNotifier } from "@/components/GroupNotifier";
import { DirectMessagesHost } from "@/components/DirectMessagesHost";
import { MonetagInPagePush } from "@/components/MonetagInPagePush";
import { ContextMenuHost } from "@/components/ContextMenuHost";
import { CallHost } from "@/components/CallHost";
import { RoomCallHost } from "@/components/RoomCallHost";
import { PushRegistrar } from "@/components/PushRegistrar";
import { ProModalHost } from "@/components/ProModalHost";
import { NtPopups } from "@/components/NtPopups";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import { IOS_VIEWPORT_SCRIPT } from "@/lib/iosViewport";
import { LOCALE_INIT_SCRIPT, LOCALE_TAGS, SERVER_LOCALE } from "@/lib/i18n";
import { I18nGate } from "@/components/I18nGate";
import { CHUNK_RECOVERY_SCRIPT } from "@/lib/chunkRecovery";
import "./globals.css";
import SupressErrors from "./middlewares/SupressErrors";
import { translate } from "@/lib/i18n";

const UMAMI_WEBSITE_ID = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;
// Google Analytics 4, alongside Umami rather than instead of it — see
// lib/analytics.ts, which sends every event to both. Only an ID in GA4's own
// shape is used: it is written into an inline script below, and a malformed
// value there would be a script error on every page (or worse).
const GA_MEASUREMENT_ID = /^G-[A-Z0-9]+$/.test(process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? "")
  ? process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID
  : undefined;
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

const SITE_URL = "https://golive.nemtudo.me";
const SITE_NAME = translate("common.golive");
// Two titles on purpose. TITLE is what goes in <title> and it leads with what
// people actually type into Google ("transmitir tela online em grupo"), because
// the first words of a title carry the most weight and a title that opened with
// the brand was spending that weight on a word nobody searches for yet.
// SHARE_TITLE keeps the brand-first wording for Open Graph/Twitter, where the
// reader already clicked a link from someone they know and the brand is the
// useful part.
const TITLE = translate("layout.seoTitle");
const SHARE_TITLE = translate("common.goliveFreeOnlineGroupScreenSharing");
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
    // The site serves one URL in whichever language the browser asks for, so
    // every one of these points at the same page. That is exactly what
    // x-default is for, and naming the three catalogs the app actually ships
    // tells Google the page is a valid result for a search in any of them
    // instead of leaving it to guess from the rendered copy.
    languages: {
      "pt-BR": "/",
      en: "/",
      es: "/",
      "x-default": "/",
    },
  },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: SHARE_TITLE,
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
    title: SHARE_TITLE,
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
  // Monetag site ownership verification.
  other: {
    monetag: "06e75928dc8614ed767ab5b24e850d52",
  },
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

// A @graph rather than a single node, so the two things this site is can both
// be stated: a free web app, and a website with a name Google can show as a
// sitelink title. `inLanguage` follows the language actually rendered — it
// used to say "en" under Portuguese copy, which is the same contradiction the
// <html lang> below had.
const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebApplication",
      "@id": `${SITE_URL}/#app`,
      name: SITE_NAME,
      url: SITE_URL,
      description: DESCRIPTION,
      applicationCategory: "CommunicationApplication",
      // Free, browser-based and with no account required are the three things
      // that separate this from Zoom/Meet in a search result, so they are
      // stated as data and not only as prose.
      operatingSystem: translate("layout.anyWebBrowser"),
      browserRequirements: translate("layout.requiresAModernBrowserWith"),
      inLanguage: LOCALE_TAGS[SERVER_LOCALE],
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "BRL",
      },
      featureList: [
        translate("layout.featureShareScreenWithAudio"),
        translate("layout.featureCameraAndMicrophone"),
        translate("layout.featurePublicAndPrivateRooms"),
        translate("layout.featureNoInstallNoSignup"),
        translate("layout.featureGroupTextChat"),
      ],
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      name: SITE_NAME,
      url: SITE_URL,
      description: DESCRIPTION,
      inLanguage: LOCALE_TAGS[SERVER_LOCALE],
      publisher: {
        "@type": "Person",
        name: translate("layout.nemtudo"),
        url: "https://nemtudo.me",
      },
    },
  ],
};


export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      // The language the server actually renders (lib/i18n's DEFAULT_LOCALE,
      // today pt-BR) — not a fixed "en". This attribute is a ranking and
      // snippet signal: Google reads it to decide which language's results
      // this page belongs in, and declaring English over Portuguese body copy
      // was keeping the site out of pt-BR queries entirely. A browser that
      // wants another language is still corrected before paint by
      // LOCALE_INIT_SCRIPT, and I18nGate swaps the words after hydration.
      lang={LOCALE_TAGS[SERVER_LOCALE]}
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
        {/* Stops iOS zooming into every text box that is focused — see
            lib/iosViewport.ts. Inline and this early because the first thing
            somebody does on a shared room link can be tapping the name field,
            which is well before hydration. */}
        <script dangerouslySetInnerHTML={{ __html: IOS_VIEWPORT_SCRIPT }} />
        {/* Same reasoning as the theme script above, for <html lang>: a
            screen reader picks its voice from that attribute, and waiting for
            React would mean reading the first paint in the wrong accent. */}
        <script dangerouslySetInnerHTML={{ __html: LOCALE_INIT_SCRIPT }} />
        {/* Before anything else that could fail, because what it listens for
            is exactly the bundle failing to arrive — see lib/chunkRecovery.ts.
            Inline for the same reason the theme script above is: it has to
            work in the one situation where none of the app's own code runs. */}
        <script dangerouslySetInnerHTML={{ __html: CHUNK_RECOVERY_SCRIPT }} />
        {/* A plain <script>, not next/script. next/script defaults to
            afterInteractive, which injects the tag from JavaScript after
            hydration - so this block existed only inside the RSC payload and
            never as a real element in the served HTML. Structured data that a
            crawler has to execute the app to find is structured data doing
            half its job; it carries no behaviour, so there is nothing to defer
            in the first place. */}
        <script
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
                <LastScreenRestorer />
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
                {/* Keeps the desktop app's taskbar entry flashing while the
                    bell has anything unread. Renders nothing. */}
                <DesktopUnreadFlash />
                {/* Same job for group messages somebody asked to hear about. */}
                <GroupNotifier />
                {/* The one conversation window on the page — see its own comment. */}
                <DirectMessagesHost />
                <ContextMenuHost />
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
                {/* Floating ad, experiment-gated — see the component. */}
                <MonetagInPagePush />
                {children}
                {/* The app's bottom tabs below lg, after the page so its spacer
                    closes the page's own flow — see components/MobileTabBar. */}
                <MobileTabBar />
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
        {GA_MEASUREMENT_ID && (
          <>
            {/* The standard gtag snippet. Page views need nothing more than
                this: GA4's enhanced measurement counts client-side
                navigations (history changes) on its own, which is every
                navigation in this app after the first load. Custom events
                arrive through lib/analytics.ts's trackEvent. */}
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
              strategy="afterInteractive"
            />
            <Script id="ga-init" strategy="afterInteractive">
              {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}window.gtag=gtag;gtag('js',new Date());gtag('config','${GA_MEASUREMENT_ID}');`}
            </Script>
          </>
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

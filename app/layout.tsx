import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { AnnouncementBanner } from "@/components/AnnouncementBanner";
import { InstallAppButton } from "@/components/InstallAppButton";
import { UpdateAppButton } from "@/components/UpdateAppButton";
import { AuthProvider } from "@/lib/AuthContext";
import { NtPopups } from "@/components/NtPopups";
import "./globals.css";
import SupressErrors from "./middlewares/SupressErrors";

const UMAMI_WEBSITE_ID = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

const SITE_URL = "https://golive.nemtudo.me";
const SITE_NAME = "GoLive";
const TITLE = "GoLive — Transmissão de Tela em Grupo Online Grátis";
const DESCRIPTION =
  "Transmita sua voz, tela ou câmera para várias pessoas ao mesmo tempo, direto do navegador. Sem cadastro. A forma mais fácil de fazer chamadas em grupo online.";

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
    "transmissão de tela online",
    "transmitir tela em grupo",
    "transmissão de tela em grupo online fácil",
    "compartilhar tela online",
    "compartilhamento de tela em grupo",
    "compartilhar tela com amigos",
    "assistir tela em grupo",
    "sala de compartilhamento de tela",

    "transmitir câmera",
    "transmissão de câmera online",
    "transmitir câmera em grupo",
    "transmissão de câmera em grupo online fácil",
    "compartilhar câmera online",
    "compartilhamento de câmera em grupo",
    "compartilhar câmera com amigos",
    "assistir câmera em grupo",
    "sala de compartilhamento de câmera",

    "transmitir voz",
    "transmissão de voz online",
    "transmitir voz em grupo",
    "transmissão de voz em grupo online fácil",
    "compartilhar voz online",
    "compartilhamento de voz em grupo",
    "compartilhar voz com amigos",
    "assistir voz em grupo",
    "sala de compartilhamento de voz",

    "screen share online grátis",
    "GoLive",
    "AntiJanja"
  ],
  applicationName: SITE_NAME,
  authors: [{ name: "NemTudo", url: "https://discord.gg/nemtudo" }],
  creator: "NemTudo",
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
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "GoLive — transmissão de tela em grupo online",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/opengraph-image"],
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
  inLanguage: "pt-BR",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "BRL",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-full flex flex-col">
        <Script
          id="jsonld-webapplication"
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <SupressErrors>
          <AuthProvider>
            <NtPopups>
              <AnnouncementBanner />
              {children}
              <InstallAppButton />
            </NtPopups>
          </AuthProvider>
        </SupressErrors>
        {UMAMI_WEBSITE_ID && (
          <Script
            // src="/api/umami/script.js"
            src={`${process.env.UMAMI_URL}/script.js`}
            data-website-id={UMAMI_WEBSITE_ID}
            strategy="afterInteractive"
          />
        )}
        {TURNSTILE_SITE_KEY && (
          // render=explicit: lib/turnstile.ts renders its own widget
          // programmatically (see getTurnstileToken) instead of the script
          // auto-rendering anything with a "cf-turnstile" class.
          <Script
            src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
            strategy="afterInteractive"
          />
        )}
      </body>
    </html>
  );
}

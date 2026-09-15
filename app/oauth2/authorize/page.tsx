import type { Metadata } from "next";
import { Suspense } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { AuthorizeClient } from "@/components/oauth2/AuthorizeClient";

// /oauth2/authorize — the consent screen for "Entrar com GoLive".
//
// The address every application sends people to (see the API's
// oauth2Routes.ts, which also answers this path with a redirect here so a
// developer can use either). Everything is read in the browser: what it shows
// depends on who is looking and on a query only the application composed, and
// none of it is worth a link preview.
//
// noindex for the same reason the "add a bot to a group" page is: a URL with
// somebody else's client_id and state in it has no business in a search
// result.

export const metadata: Metadata = {
  title: "Autorizar aplicativo — GoLive",
  robots: { index: false, follow: false },
};

export default function OAuth2AuthorizePage() {
  return (
    <div className="flex min-h-dvh flex-col bg-zinc-50 dark:bg-black">
      <SiteHeader />
      {/* The card reads the query the application composed, so it cannot be
          prerendered — the boundary is what lets the rest of the page be, and
          without it the build refuses this route outright. */}
      <Suspense fallback={<div className="flex-1" />}>
        <AuthorizeClient />
      </Suspense>
    </div>
  );
}

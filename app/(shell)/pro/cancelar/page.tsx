import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { pageMetadata } from "@/lib/seo";
import { translate } from "@/lib/i18n";
import { CancelSubscriptionPanel } from "./CancelSubscriptionPanel";

// Ending a subscription, on a page of its own.
//
// Its own page rather than a dialog on /pro for two reasons. The first is the
// sign-in it asks for before anything else (see CancelSubscriptionPanel): a
// login form inside a popup inside the page that sells the plan reads as the
// site having logged somebody out. The second is that a page has an address,
// so "como cancelo?" has an answer somebody can paste.
//
// Out of the index. Nothing here is worth finding by search, and a results
// page whose top hit for the product is "cancelar" is a strange first
// impression.
export const metadata: Metadata = pageMetadata({
  path: "/pro/cancelar",
  get title() {
    return translate("cancelPage.metaTitle");
  },
  get description() {
    return translate("cancelPage.metaDescription");
  },
  noindex: true,
});

export default function CancelSubscriptionPage() {
  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <SiteHeader />
      <CancelSubscriptionPanel />
    </div>
  );
}

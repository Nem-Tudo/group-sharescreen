import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { translate } from "@/lib/i18n";
import { PartnerDashboard } from "./PartnerDashboard";

// The advertiser's own dashboard. One account's orders: nothing to index.
export const metadata: Metadata = {
  get title() { return translate("partnerOrders.myAds"); },
  robots: { index: false, follow: false },
};

export default function PartnerDashboardPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-zinc-50 dark:bg-black">
      <SiteHeader />
      <PartnerDashboard />
    </div>
  );
}

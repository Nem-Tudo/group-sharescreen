import { Suspense } from "react";
import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { translate } from "@/lib/i18n";
import { PartnerOrderDetail } from "./PartnerOrderDetail";

export const metadata: Metadata = {
  get title() { return translate("partnerOrders.myAds"); },
  robots: { index: false, follow: false },
};

export default async function PartnerOrderPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  return (
    <div className="flex min-h-dvh flex-col bg-zinc-50 dark:bg-black">
      <SiteHeader />
      <Suspense>
        <PartnerOrderDetail id={id} />
      </Suspense>
    </div>
  );
}

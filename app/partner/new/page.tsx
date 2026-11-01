import { Suspense } from "react";
import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { translate } from "@/lib/i18n";
import { PartnerWizard } from "./PartnerWizard";

export const metadata: Metadata = {
  get title() { return translate("partnerOrders.wizard.title"); },
  robots: { index: false, follow: false },
};

export default function NewPartnerOrderPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-zinc-50 dark:bg-black">
      <SiteHeader />
      {/* useSearchParams (?from=, ?package=) needs a boundary to render statically. */}
      <Suspense>
        <PartnerWizard />
      </Suspense>
    </div>
  );
}

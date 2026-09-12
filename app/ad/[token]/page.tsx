import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { PartnerReportClient } from "./PartnerReportClient";
import { translate } from "@/lib/i18n";

// A link-only page: the token in the URL is what authorizes reading it (see
// the API's GET /partner-report/:token), so it must never be indexed — a
// crawler that found one link would publish an advertiser's numbers to search.
// `nofollow`/`noarchive` on top of `noindex` for the same reason.
export const metadata: Metadata = {
  get title() { return translate("common.adReport"); },
  get description() { return translate("ad.realTimeStatsForAnAd"); },
  robots: { index: false, follow: false, nocache: true, noarchive: true },
};

export default async function PartnerReportPage(props: PageProps<"/ad/[token]">) {
  const { token } = await props.params;
  return (
    <div className="flex min-h-dvh flex-col bg-zinc-50 dark:bg-black">
      <SiteHeader />
      <PartnerReportClient token={token} />
    </div>
  );
}

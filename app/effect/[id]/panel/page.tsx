import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { EffectReportClient } from "./EffectReportClient";
import { translate } from "@/lib/i18n";

export const metadata: Metadata = {
  get title() { return translate("cameraWorkshop.panel"); },
  // About one person's own work, and the API refuses it to anybody else. The
  // effect's public page is one level up.
  robots: { index: false, follow: false },
};

export default async function EffectReportPage(props: PageProps<"/effect/[id]/panel">) {
  const { id } = await props.params;
  return (
    <div className="flex min-h-dvh flex-col bg-zinc-50 dark:bg-black">
      <SiteHeader />
      <EffectReportClient id={id} />
    </div>
  );
}

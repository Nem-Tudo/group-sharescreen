import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { CameraEffectWorkshopPage } from "@/components/CameraEffectBrowser";
import { pageMetadata } from "@/lib/seo";
import { translate } from "@/lib/i18n";

export const metadata: Metadata = pageMetadata({
  path: "/workshop/effects",
  title: translate("cameraWorkshop.title"),
  description: translate("cameraWorkshop.subtitle"),
});

export default function WorkshopEffectsPage() {
  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <SiteHeader />
      <CameraEffectWorkshopPage />
    </div>
  );
}

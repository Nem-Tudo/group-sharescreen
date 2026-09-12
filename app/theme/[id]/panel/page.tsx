import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { ThemeReportClient } from "./ThemeReportClient";
import { translate } from "@/lib/i18n";

export const metadata: Metadata = {
  get title() { return translate("common.themeDashboard"); },
  // Never indexed and never shared: the page is about one person's own work,
  // the API refuses it to anybody else, and a card for it would be a link that
  // says nothing to whoever it reached. The *theme* has a public page one level
  // up, at /theme/[id] — that is the one worth sharing.
  robots: { index: false, follow: false },
};

export default async function ThemeReportPage(props: PageProps<"/theme/[id]/panel">) {
  const { id } = await props.params;
  return (
    <div className="flex min-h-dvh flex-col bg-zinc-50 dark:bg-black">
      <SiteHeader />
      <ThemeReportClient id={id} />
    </div>
  );
}

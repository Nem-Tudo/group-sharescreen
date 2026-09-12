import type { Metadata } from "next";
import { translate } from "@/lib/i18n";
import { TermsContent } from "./TermsContent";

export const metadata: Metadata = {
  get title() { return translate("terms.termsOfUseAndPrivacy"); },
  get description() { return translate("terms.goliveSTermsOfUseAnd"); },
  alternates: {
    canonical: "/terms",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function Page() {
  return <TermsContent />;
}

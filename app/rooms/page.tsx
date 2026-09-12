import type { Metadata } from "next";
import { RoomsPageClient } from "./RoomsPageClient";
import { translate } from "@/lib/i18n";

export const metadata: Metadata = {
  get title() { return translate("rooms.publicScreenSharingRooms"); },
  get description() { return translate("rooms.seeThePublicGroupScreenSharing"); },
  alternates: {
    canonical: "/rooms",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RoomsPage() {
  return <RoomsPageClient />;
}

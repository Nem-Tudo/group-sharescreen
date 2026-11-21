import type { Metadata } from "next";
import { RoomsMapClient } from "./RoomsMapClient";
import { translate } from "@/lib/i18n";

export const metadata: Metadata = {
  get title() { return translate("worldmap.publicRoomsMap"); },
  get description() { return translate("worldmap.seeOnTheWorldMapWhere"); },
  alternates: {
    canonical: "/worldmap",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RoomsMapPage() {
  return <RoomsMapClient />;
}

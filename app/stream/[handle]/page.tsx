import type { Metadata } from "next";
import { StreamRoomDashboard } from "./StreamRoomDashboard";
import { translate } from "@/lib/i18n";

export async function generateMetadata(
  props: { params: Promise<{ handle: string }> }
): Promise<Metadata> {
  const { handle } = await props.params;
  return {
    title: translate("stream.broadcastSourcesRoomHandle", { handle }),
    description: translate("stream.exportBroadcastsFromRoomHandleTo", { handle }),
    robots: { index: false, follow: false },
  };
}

export default async function StreamDashboardPage(
  props: { params: Promise<{ handle: string }> }
) {
  const { handle } = await props.params;
  return <StreamRoomDashboard handle={handle} />;
}


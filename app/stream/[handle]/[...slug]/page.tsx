import type { Metadata } from "next";
import { StreamViewer } from "./StreamViewer";
import { translate } from "@/lib/i18n";

export const metadata: Metadata = {
  get title() { return translate("stream.goliveBroadcastSource"); },
  robots: { index: false, follow: false },
};

export default async function StreamPage(
  props: { params: Promise<{ handle: string; slug: string[] }> }
) {
  const { handle, slug } = await props.params;
  return <StreamViewer handle={handle} slug={slug} />;
}


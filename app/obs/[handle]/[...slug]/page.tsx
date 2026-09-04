import type { Metadata } from "next";
import { ObsViewer } from "./ObsViewer";

export const metadata: Metadata = {
  title: "GoLive · Fonte de Transmissão",
  robots: { index: false, follow: false },
};

export default async function ObsStreamPage(
  props: { params: Promise<{ handle: string; slug: string[] }> }
) {
  const { handle, slug } = await props.params;
  return <ObsViewer handle={handle} slug={slug} />;
}


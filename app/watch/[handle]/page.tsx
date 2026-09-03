import type { Metadata } from "next";
import { RoomAppGate } from "@/components/RoomAppGate";
import { WatchRoom } from "./WatchRoom";

export async function generateMetadata(
  props: PageProps<"/watch/[handle]">
): Promise<Metadata> {
  const { handle } = await props.params;
  return {
    title: `Sala ${handle}`,
    description: `Entre na sala "${handle}" no GoLive para transmitir ou assistir tela em grupo, ao vivo e sem cadastro.`,
    robots: {
      index: false,
      follow: false,
    },
  };
}

export default async function WatchPage(props: PageProps<"/watch/[handle]">) {
  const { handle } = await props.params;
  // The gate wraps the room rather than living inside it, and that placement
  // is the feature: WatchRoom connects, registers a name and turns on a
  // microphone as soon as it mounts, so the only way to offer the app
  // *before* joining is to not mount it yet. See components/RoomAppGate.tsx.
  return (
    <RoomAppGate handle={handle}>
      <WatchRoom handle={handle} />
    </RoomAppGate>
  );
}

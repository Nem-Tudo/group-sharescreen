import type { Metadata } from "next";
import { RoomAppGate } from "@/components/RoomAppGate";
import { WatchRoom } from "./WatchRoom";

/** The prefix a private room's handle carries. See lib/roomsApi.ts. */
const PRIVATE_PREFIX = "priv-";

export async function generateMetadata(
  props: PageProps<"/watch/[handle]">
): Promise<Metadata> {
  const { handle } = await props.params;
  // A private room's handle *is* its access code (see roomCodeFromHandle), so
  // it is the one thing that must not be printed anywhere a preview might
  // read. The link already carries it — that is unavoidable, it is how
  // somebody gets in — but a title repeats it into every chat the link is
  // forwarded to.
  const secret = handle.startsWith(PRIVATE_PREFIX);

  // Deliberately no `openGraph` and no `twitter` here, which is what makes a
  // room link preview exactly as the home page does: a child that leaves them
  // out inherits the root's whole card (see app/layout.tsx), picture included.
  //
  // It used to have a generated card of its own, in the room's own colours
  // with the room's name on it. This is the deliberate choice not to: an
  // invite is pasted into a chat to be *clicked*, and the card people already
  // recognise as "this is GoLive" does that job better than one that describes
  // a room they cannot see yet.
  //
  // The title and description below are still the room's. They are what a
  // browser tab and a bookmark show, and neither of those is the embed.
  return {
    title: secret ? "Sala privada" : `Sala ${handle}`,
    description: secret
      ? "Alguém te convidou para uma sala privada no GoLive. Abra o link para entrar."
      : `Entre na sala "${handle}" no GoLive para transmitir ou assistir tela em grupo, ao vivo e sem cadastro.`,
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

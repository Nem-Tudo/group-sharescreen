import type { Metadata } from "next";
import { RoomAppGate } from "@/components/RoomAppGate";
import { WatchRoom } from "./WatchRoom";
import { pageMetadata } from "@/lib/seo";

/** The prefix a private room's handle carries. See lib/roomsApi.ts. */
const PRIVATE_PREFIX = "priv-";

export async function generateMetadata(
  props: PageProps<"/watch/[handle]">
): Promise<Metadata> {
  const { handle } = await props.params;
  // A private room's handle *is* its access code (see roomCodeFromHandle), so
  // it is the one thing that must not be printed on a card. The link already
  // carries it — that is unavoidable, it is how somebody gets in — but a
  // preview repeats it into every chat the link is forwarded to, in a picture
  // that outlives the message.
  const secret = handle.startsWith(PRIVATE_PREFIX);
  const name = secret ? "Sala privada" : `Sala ${handle}`;
  return pageMetadata({
    path: `/watch/${handle}`,
    title: name,
    description: secret
      ? "Alguém te convidou para uma sala privada no GoLive. Abra o link para entrar."
      : `Entre na sala "${handle}" no GoLive para transmitir ou assistir tela em grupo, ao vivo e sem cadastro.`,
    // Never in a search result, always shareable — which is the whole reason
    // it still gets a card. See pageMetadata's note on the two being separate.
    noindex: true,
    card: {
      title: secret ? "Você foi convidado" : handle,
      subtitle: secret
        ? "Uma sala privada no GoLive está te esperando."
        : "Transmita ou assista tela em grupo, ao vivo e sem cadastro.",
      tone: "room",
      badge: secret ? "Sala privada" : "Sala ao vivo",
    },
  });
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

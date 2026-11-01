import type { Metadata } from "next";
import { PhoneCameraSource } from "@/components/PhoneCameraSource";
import { translate } from "@/lib/i18n";

// What the QR code of "Celular como câmera" opens: this phone becomes the
// camera of the computer that showed it (see components/PhoneCameraSource).

export const metadata: Metadata = {
  title: translate("cam.title"),
  robots: { index: false, follow: false },
};

export default async function PhoneCameraLinkPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  return <PhoneCameraSource token={token} />;
}

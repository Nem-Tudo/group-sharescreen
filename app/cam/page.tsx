import type { Metadata } from "next";
import { PhoneCameraSource } from "@/components/PhoneCameraSource";
import { translate } from "@/lib/i18n";

// "Celular como câmera" without a link: a phone saved before comes back in
// with the pairing it keeps (see components/PhoneCameraSource).

export const metadata: Metadata = {
  title: translate("cam.title"),
  robots: { index: false, follow: false },
};

export default function PhoneCameraPage() {
  return <PhoneCameraSource token={null} />;
}

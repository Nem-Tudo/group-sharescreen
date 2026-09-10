"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// The redirect, moved into the browser.
//
// It used to be a server `redirect()`, which was simpler and had one fatal
// property for a link whose whole job is to be shared: a crawler asking about
// /gift/<code> got a 307 and followed it to the home page, so every present
// pasted into a chat previewed as the generic "GoLive — transmissão de tela".
// Metadata is never sent with a redirect; there is no page for it to sit on.
//
// So the page renders — which is what lets generateMetadata beside this file
// describe the actual present — and the browser is what moves on. A crawler
// reads the card and stops, because it does not run this.
//
// `replace` rather than `push`: the intermediate address is not a place
// anybody should be able to go "back" to, and going back to it would only
// bounce them forward again.

export function GiftRedirect({ code }: { code: string }) {
  const router = useRouter();

  useEffect(() => {
    router.replace(`/?gift=${encodeURIComponent(code)}`);
  }, [router, code]);

  return null;
}

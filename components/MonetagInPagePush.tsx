"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useAdsAllowed } from "@/lib/useAdsAllowed";

// Monetag's In-Page Push — the site's ad network.
//
// Not a box in the layout: the tag floats a notification-style ad over the
// page wherever Monetag decides. So it never loads on a room page (/watch,
// /groups), where it would sit on top of the stream or the chat. Gated like
// every ad (useAdsAllowed): the admin panel's switch (MonetagPanel), Pro's
// `no_ads`, and the desktop/Android shells.
//
// Once the script runs it cannot be unloaded — switching it off in the admin,
// or a client-side navigation into a room, only takes effect on the next full
// page load.

const ZONE = "11835375";
const SRC = "https://nap5k.com/tag.min.js";

let injected = false;

function isRoomPath(pathname: string | null): boolean {
  return !!pathname && (pathname.startsWith("/watch") || pathname.startsWith("/groups"));
}

export function MonetagInPagePush() {
  const pathname = usePathname();
  const adsAllowed = useAdsAllowed();
  const eligible = adsAllowed && !isRoomPath(pathname);

  useEffect(() => {
    if (!eligible || injected) return;
    injected = true;
    const script = document.createElement("script");
    script.dataset.zone = ZONE;
    script.src = SRC;
    (document.body || document.documentElement).appendChild(script);
  }, [eligible]);

  return null;
}

import { NextResponse, type NextRequest } from "next/server";
import {
  NATIVE_BANNER,
  bannerDocument,
  bannerForSlot,
  nativeDocument,
  type AdSlot,
} from "@/lib/adsterra";

// Serves the little HTML document an ad slot's iframe loads.
//
// Its whole reason to exist is the origin. The same markup used to be handed
// straight to the iframe as `srcdoc`, which gives the document an opaque
// origin — and on an opaque origin Adsterra's script throws on localStorage,
// cannot set its cookies, and reports an empty referrer to an ad server that
// decides what to serve by checking the referrer against the publisher's
// registered domains. Nothing filled. Served from here, the document is an
// ordinary page on this site and all three work. See lib/adsterra.ts's header.
//
// The one thing that must never be true of this route: nothing from the
// request may reach the HTML. `slot` is matched against a fixed list and used
// only to pick which already-configured unit to render — the key and the
// script host come from this deployment's own environment. A route that let a
// caller name a script URL would be an XSS endpoint wearing an ad's clothes.

const SLOTS: readonly AdSlot[] = ["desktop", "mobile", "native"];

function isSlot(value: string | null): value is AdSlot {
  return value !== null && (SLOTS as readonly string[]).includes(value);
}

export async function GET(request: NextRequest) {
  const slot = request.nextUrl.searchParams.get("slot");
  if (!isSlot(slot)) {
    return NextResponse.json({ error: "unknown slot" }, { status: 404 });
  }

  const html =
    slot === "native"
      ? NATIVE_BANNER && nativeDocument(NATIVE_BANNER)
      : (() => {
          const unit = bannerForSlot(slot);
          return unit && bannerDocument(unit);
        })();

  // Not configured for this deployment. A 404 rather than an empty document,
  // so a slot that should not exist fails loudly in the network tab instead
  // of looking like an ad that never filled.
  if (!html) {
    return NextResponse.json({ error: "slot not configured" }, { status: 404 });
  }

  return new NextResponse(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // The document is one script tag and a probe, and the ad behind it is
      // decided per impression by Adsterra. Caching the wrapper would save
      // nothing worth having and risks a stale key surviving a deploy.
      "cache-control": "no-store",
      // Framing is the only thing this is for, and only by this site. Ads are
      // a natural clickjacking wrapper for someone else's page, so say so.
      "x-frame-options": "SAMEORIGIN",
    },
  });
}

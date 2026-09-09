import { NextResponse } from "next/server";

// The site-status feed, proxied.
//
// Two reasons this is not fetched straight from the browser:
//
//   1. CORS. The upstream answers `text/plain` with no
//      `access-control-allow-origin`, so a fetch from the site's own origin
//      is refused before the body is ever read. Nothing on that host has to
//      change for this to work — the request is made from here instead.
//   2. Volume. Every open tab asks once a minute; going through this handler
//      means one upstream read per REVALIDATE_SECONDS for the whole site,
//      however many people are looking.
//
// Read at request time from the environment rather than baked in, so the feed
// can be pointed somewhere else (a mirror, a local file server while testing)
// by restarting the container — no rebuild, unlike anything NEXT_PUBLIC_.
const STATUS_URL = process.env.STATUS_URL || "https://bin.nemtudo.me/raw/golive-status";

// How long one upstream answer is reused for. Shorter than the client's own
// minute so the two do not beat against each other and turn a 60s poll into a
// 120s worst case — an outage notice that takes two minutes to appear is one
// people read after they have already given up.
const REVALIDATE_SECONDS = 20;

// Ceiling on the upstream read. This endpoint sits in front of a banner that
// says the site is broken; it must never itself be the slow thing on a page.
const UPSTREAM_TIMEOUT_MS = 5000;

/** What the feed says, once it has been checked. */
export interface SiteStatus {
  apiError: boolean;
  message: string;
  button: { label: string; href: string; newTab: boolean } | null;
}

const OK: SiteStatus = { apiError: false, message: "", button: null };

// Nothing here trusts the shape of what comes back: it is a file somebody
// edits by hand, under time pressure, precisely when something is already on
// fire. A typo in it has to end as "no banner", never as a crash or a red bar
// with `undefined` in it.
function parseStatus(raw: unknown): SiteStatus {
  if (!raw || typeof raw !== "object") return OK;
  const data = raw as Record<string, unknown>;
  if (data.api_error !== true) return OK;
  const message = typeof data.message === "string" ? data.message.trim() : "";
  // An outage with no words is not something to put on screen — the bar's
  // whole content is the sentence.
  if (!message) return OK;

  let button: SiteStatus["button"] = null;
  const rawButton = data.button;
  if (rawButton && typeof rawButton === "object") {
    const b = rawButton as Record<string, unknown>;
    const label = typeof b.label === "string" ? b.label.trim() : "";
    const href = typeof b.href === "string" ? b.href.trim() : "";
    // http(s) only. The href is remote text rendered as a link, and
    // `javascript:` in an <a> is script execution on our own origin — cheap
    // to rule out here, and this is the one place it can be ruled out for
    // every reader at once.
    const safeHref = /^https?:\/\//i.test(href) ? href : "";
    if (b.enabled === true && label && safeHref) {
      button = { label: label.slice(0, 40), href: safeHref, newTab: b.target === "_blank" };
    }
  }

  return { apiError: true, message: message.slice(0, 300), button };
}

export async function GET() {
  let status = OK;
  try {
    const res = await fetch(STATUS_URL, {
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (res.ok) {
      // Parsed by hand rather than with res.json(): the upstream serves this
      // as text/plain, and the file is hand-edited — a trailing comma left
      // behind at 3am must not throw out of this handler.
      const text = await res.text();
      status = parseStatus(JSON.parse(text));
    }
  } catch {
    // Unreachable, slow, or unparseable all mean the same thing here: we do
    // not know of an outage. Saying nothing is the only safe direction — this
    // banner cannot be closed, so painting one on a guess would be a red bar
    // over a working site that nobody can get rid of.
  }

  return NextResponse.json(status, {
    // The client is the one on a clock (see useSiteStatus). Letting a browser
    // or a CDN hold this would put an arbitrary second cache in front of a
    // number that already has one, on the far side of this handler.
    headers: { "cache-control": "no-store" },
  });
}

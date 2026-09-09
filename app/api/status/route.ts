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
//      means one upstream read per CACHE_MS for the whole site, however
//      many people are looking.
//
// Read at request time from the environment rather than baked in, so the feed
// can be pointed somewhere else (a mirror, a local file server while testing)
// by restarting the container — no rebuild, unlike anything NEXT_PUBLIC_.
const STATUS_URL = process.env.STATUS_URL || "https://bin.nemtudo.me/raw/golive-status";

// How long one upstream answer is reused for. Shorter than the client's own
// minute so the two do not beat against each other and turn a 60s poll into a
// 120s worst case — an outage notice that takes two minutes to appear is one
// people read after they have already given up.
const CACHE_MS = 20_000;

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

// The answer, and when it was read. Kept here rather than in Next's fetch
// cache (`next: { revalidate }`) on purpose: that cache refreshes a stale
// entry in the background with a fetch of its own, and that fetch is not the
// one written below — Next drops the `signal` when revalidating (see
// `doOriginalFetch` in next/dist/server/lib/patch-fetch.js), so the read runs
// under undici's 10s connect default instead of our ceiling, outside this
// module's try/catch, and its failure is printed straight to the console by
// the framework. With the upstream host unreachable that is a stack trace
// every 20s that no code here can catch. Holding the value ourselves keeps
// every read on the path below, where a dead host is already an expected
// answer.
let cached: { at: number; status: SiteStatus } | null = null;
let inFlight: Promise<void> | null = null;

/** One upstream read. Never rejects; null means "could not ask". */
async function readUpstream(): Promise<SiteStatus | null> {
  try {
    const res = await fetch(STATUS_URL, {
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return null;
    // Parsed by hand rather than with res.json(): the upstream serves this as
    // text/plain, and the file is hand-edited — a trailing comma left behind
    // at 3am must not throw out of this handler.
    const text = await res.text();
    return parseStatus(JSON.parse(text));
  } catch {
    // Unreachable, slow, or unparseable all mean the same thing here: we did
    // not get an answer. Which is not the same as "there is no outage" — see
    // below for what gets served instead.
    return null;
  }
}

function refresh(): Promise<void> {
  inFlight ??= readUpstream()
    .then((fresh) => {
      // A failed read keeps the last answer we did get rather than clearing
      // it: the upstream going quiet is not evidence that the site came back,
      // and dropping the banner mid-outage is the one direction that misleads
      // people. The timestamp moves either way, so a dead host is retried on
      // the same 20s cadence instead of on every request.
      cached = { at: Date.now(), status: fresh ?? cached?.status ?? OK };
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export async function GET() {
  // Stale answers are served while the refresh runs behind them. This
  // endpoint sits in front of a banner that says the site is broken; once
  // warm it must never make anyone wait on a third party to find that out.
  if (!cached) await refresh();
  else if (Date.now() - cached.at >= CACHE_MS) void refresh();

  return NextResponse.json(cached?.status ?? OK, {
    // The client is the one on a clock (see useSiteStatus). Letting a browser
    // or a CDN hold this would put an arbitrary second cache in front of a
    // number that already has one, on the far side of this handler.
    headers: { "cache-control": "no-store" },
  });
}


// The Adsterra slots, and the two decisions that shape them.
//
// **Why an iframe at all.** Not because of `document.write` — their invoke.js
// does not use it (checked, not assumed: it builds elements and appends
// them). It is because the banner format reads a *global*, `atOptions`, at
// script-load time: two banners on one page would race for one variable, and
// the second would silently render the first one's unit. A document each
// removes the shared name. It also keeps an ad script that misbehaves away
// from the app's own DOM.
//
// **Why the iframe is same-origin.** This started out sandboxed onto an
// opaque origin, to keep an ad network away from the account's JWT in
// localStorage (see accountApi.ts). That was airtight and it did not work: on
// an opaque origin `localStorage` *throws*, cookies are refused, and
// `document.referrer` is empty — and their script wants all three, the last
// one to prove the page is a domain the publisher registered. The slot
// loaded, filled with nothing, and removed itself.
//
// So the frame is served from a real URL on this site (see
// app/ads/frame/route.ts) instead. The script gets the origin, the cookies
// and the referrer it needs, and this is the same exposure the vendor's own
// snippet has — theirs runs directly in the page. What is still withheld is
// `allow-top-navigation`: the frame cannot redirect the whole site out from
// under somebody, which is the abuse this format is actually known for.
//
// The honest residue: an ad script running same-origin can read this site's
// localStorage, JWT included. The way to close that without losing fill is to
// serve this route from a *different* hostname that Adsterra also has on
// file — a subdomain would do it — which is a DNS and dashboard change rather
// than a code one.

/**
 * What the ad frame is allowed to do.
 *
 *   allow-scripts .......... the ad is a script; without it nothing happens.
 *   allow-same-origin ...... storage, cookies and a referrer. Without it the
 *                            script throws on its first localStorage read and
 *                            the ad server sees an unregistered blank
 *                            referrer — see the header.
 *   allow-popups ........... a click on an ad opens a new tab.
 *   allow-popups-to-escape-sandbox
 *                           ... that tab is an ordinary tab rather than
 *                               another sandboxed one, which is what makes
 *                               the advertiser's page work.
 *   allow-forms ............ some creatives are forms.
 *
 * Deliberately absent: `allow-top-navigation`. A frame that can move the top
 * window is a frame that can replace the room somebody is in with an
 * advertiser's page, and no ad is worth that.
 */
export const IFRAME_SANDBOX =
  "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms";

/**
 * Forces an absolute https URL.
 *
 * Adsterra hands out protocol-relative snippets (`//host/key/invoke.js`),
 * which is fine in an ordinary page and a trap here: a sandboxed srcdoc
 * document has an opaque origin, and a scheme-relative URL in it has no
 * scheme to be relative *to*. Left alone it resolves against `about:` and the
 * script silently never loads — an empty slot with nothing in the console to
 * say why.
 */
function absoluteUrl(url: string): string {
  if (url.startsWith("//")) return `https:${url}`;
  if (/^https?:\/\//.test(url)) return url;
  return `https://${url.replace(/^\/+/, "")}`;
}

/** Their default delivery host; a publisher can be issued another. */
export const DEFAULT_BANNER_DOMAIN = "www.highperformanceformat.com";

/** One fixed-size banner unit, as Adsterra sells them: a key per size. */
export interface AdsterraBanner {
  key: string;
  width: number;
  height: number;
  /** Their delivery host. Differs per publisher, hence the env var. */
  domain: string;
}

export function parseBanner(
  key: string | undefined,
  width: string | undefined,
  height: string | undefined,
  domain: string | undefined
): AdsterraBanner | null {
  const parsedWidth = Number(width);
  const parsedHeight = Number(height);
  // All three or nothing. A key with no size renders a slot Adsterra will
  // never fill, which is worse than an empty page: it is a hole in the layout
  // that looks like a bug.
  if (!key || !Number.isFinite(parsedWidth) || !Number.isFinite(parsedHeight)) return null;
  if (parsedWidth <= 0 || parsedHeight <= 0) return null;
  return {
    key,
    width: parsedWidth,
    height: parsedHeight,
    domain: domain || DEFAULT_BANNER_DOMAIN,
  };
}

// Two keys because Adsterra issues one per size, and a 728x90 unit does not
// fill on a phone — it is not a responsive banner that shrinks, it is a
// different product with its own key. A deployment that sets only one gets
// that one everywhere it fits and nothing where it does not.
export const DESKTOP_BANNER = parseBanner(
  process.env.NEXT_PUBLIC_ADSTERRA_BANNER_KEY,
  process.env.NEXT_PUBLIC_ADSTERRA_BANNER_WIDTH,
  process.env.NEXT_PUBLIC_ADSTERRA_BANNER_HEIGHT,
  process.env.NEXT_PUBLIC_ADSTERRA_BANNER_DOMAIN
);

export const MOBILE_BANNER = parseBanner(
  process.env.NEXT_PUBLIC_ADSTERRA_BANNER_MOBILE_KEY,
  process.env.NEXT_PUBLIC_ADSTERRA_BANNER_MOBILE_WIDTH,
  process.env.NEXT_PUBLIC_ADSTERRA_BANNER_MOBILE_HEIGHT,
  process.env.NEXT_PUBLIC_ADSTERRA_BANNER_DOMAIN
);

/** The native-banner unit: one script, and a container it fills. */
export interface AdsterraNative {
  /** Full script URL, exactly as Adsterra gives it. */
  src: string;
  /** The div id the script writes into — `container-<key>`. */
  containerId: string;
}

export function parseNative(
  src: string | undefined,
  container: string | undefined
): AdsterraNative | null {
  if (!src) return null;
  // Adsterra's own snippet pairs `.../<key>/invoke.js` with a div whose id is
  // `container-<key>`, so the id is derivable and asking for it twice would
  // be asking somebody to keep two halves of one value in step. Overridable
  // anyway, because a derived value that is ever wrong must have a way out.
  const derived = src.replace(/\/invoke\.js.*$/, "").split("/").filter(Boolean).pop();
  const containerId = container || (derived ? `container-${derived}` : "");
  if (!containerId) return null;
  return { src, containerId };
}

export const NATIVE_BANNER = parseNative(
  process.env.NEXT_PUBLIC_ADSTERRA_NATIVE_SRC,
  process.env.NEXT_PUBLIC_ADSTERRA_NATIVE_CONTAINER
);

/** The `source` every message out of an ad iframe carries. */
export const AD_MESSAGE_SOURCE = "adsterra";

/**
 * How long a slot waits for something to be drawn before giving up on it.
 *
 * Two numbers, because the two formats paint at completely different moments
 * and one budget for both is what made the native unit look broken:
 *
 *   - the banner is `format: iframe`. Its invoke.js appends a sized <iframe>
 *     the moment it runs, so there is a box to find almost immediately —
 *     before the ad inside it has even loaded.
 *   - the native builds nothing until its own ad request comes back. A 46KB
 *     script, a request, then images. Three and a half seconds routinely ran
 *     out first, and the slot removed an ad that was still on its way.
 *
 * Neither number is the ad-blocker path. A blocker refuses the request, which
 * fires the tag's onerror in milliseconds — see fillProbeScript.
 */
export const BANNER_FILL_TIMEOUT_MS = 4000;
export const NATIVE_FILL_TIMEOUT_MS = 12000;

/**
 * The half of an ad document that watches whether an ad turned up.
 *
 * Answering "did this fill?" cannot be done from outside: the frame is a
 * document of its own, and the page has no business reaching into it. So the
 * frame says. And it cannot answer by trusting the script tag either — a
 * blocker that serves an empty stub produces a perfectly successful load with
 * nothing behind it. The test is the only one that means anything: did a box
 * with real size get drawn.
 *
 * The `reason` is the part worth getting right. "blocked" means the request
 * was refused, which is a fact about the *browser* and true for every slot on
 * the page. "empty" means the script ran and served nothing, which is a fact
 * about this *unit* alone — an ad network with no inventory for a native slot
 * right now still has a banner to serve, and reporting the two the same way
 * is how one empty native took the working banner down with it.
 *
 * `onerror` on the tag itself is set as an inline attribute rather than
 * attached here, and that is load-bearing: a classic script that fails to
 * load dispatches its error while the parser is still blocked on it, which is
 * before this script exists to listen.
 */
function fillProbeScript(timeoutMs: number): string {
  return `<script>
(function () {
  var done = false;
  function tell(filled, reason) {
    if (done) return;
    done = true;
    parent.postMessage(
      { source: "${AD_MESSAGE_SOURCE}", type: "status", filled: filled, reason: reason },
      "*"
    );
  }
  function painted() {
    var nodes = document.body.querySelectorAll("iframe,img,a,div,ins,span,canvas");
    for (var i = 0; i < nodes.length; i++) {
      var box = nodes[i].getBoundingClientRect();
      // Both dimensions, because an empty container still reports its
      // column's full width while being nothing at all to look at.
      if (box.width > 1 && box.height > 1) return true;
    }
    return false;
  }
  var deadline = Date.now() + ${timeoutMs};
  var timer = setInterval(function () {
    if (window.__adsterraBlocked) { clearInterval(timer); tell(false, "blocked"); return; }
    if (painted()) { clearInterval(timer); tell(true, null); return; }
    if (Date.now() > deadline) { clearInterval(timer); tell(false, "empty"); }
  }, 150);
})();
</script>`;
}

/**
 * The document a banner slot runs in, served at /ads/frame.
 *
 * This is Adsterra's snippet verbatim, plus a reset so the creative sits
 * flush against the iframe's edges. `atOptions` is assigned rather than
 * declared with const/let on purpose: their invoke.js reads it off the global
 * object, and a block-scoped binding would be invisible to it.
 */
export function bannerDocument(banner: AdsterraBanner): string {
  // The referrer meta is not decoration: Adsterra decides whether to serve by
  // checking it against the domains on the publisher's account. "origin"
  // sends exactly `https://golive.nemtudo.me/` and never a path, which is
  // both what they need and the least this can leak.
  const options = JSON.stringify({
    key: banner.key,
    format: "iframe",
    height: banner.height,
    width: banner.width,
    params: {},
  });
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="referrer" content="origin">
<style>html,body{margin:0;padding:0;overflow:hidden;background:transparent}</style>
</head><body>
<script type="text/javascript">window.atOptions = ${options};</script>
<script type="text/javascript" src="${absoluteUrl(`${banner.domain}/${banner.key}/invoke.js`)}" onerror="window.__adsterraBlocked=1"></script>
${fillProbeScript(BANNER_FILL_TIMEOUT_MS)}
</body></html>`;
}

/**
 * The document a native slot runs in, served at /ads/frame, plus the
 * height it reports back.
 *
 * A native banner has no fixed size — it is a grid of cards whose height
 * depends on how many the script decides to draw. The parent cannot measure
 * it, because measuring across an opaque origin is exactly what the sandbox
 * forbids, so the iframe measures itself and posts the number out.
 * `postMessage` is the one channel that still works in both directions, and
 * the parent checks the message's shape before believing it.
 */
export function nativeDocument(native: AdsterraNative): string {
  const timeoutMs = NATIVE_FILL_TIMEOUT_MS;
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="referrer" content="origin">
<style>html,body{margin:0;padding:0;background:transparent}</style>
</head><body>
<script async data-cfasync="false" src="${absoluteUrl(native.src)}" onerror="window.__adsterraBlocked=1"></script>
<div id="${native.containerId}"></div>
${fillProbeScript(NATIVE_FILL_TIMEOUT_MS)}
<script>
(function () {
  var last = 0;
  function report() {
    var height = document.documentElement.scrollHeight;
    // Only on a real change, and never downward by a pixel or two: the ad
    // reflows as its images load, and echoing every intermediate value would
    // make the slot twitch while somebody is reading past it.
    if (Math.abs(height - last) < 4) return;
    last = height;
    parent.postMessage({ source: "${AD_MESSAGE_SOURCE}", type: "height", height: height }, "*");
  }
  if (window.ResizeObserver) {
    var observer = new ResizeObserver(report);
    // Both, because either one alone misses a case: <html> is stretched to
    // the viewport by the frame, so it does not always grow with content,
    // and <body> is what the widget actually fills.
    observer.observe(document.documentElement);
    observer.observe(document.body);
  }
  // A fallback for the first paints, because the script is async and may not
  // have drawn anything by the time the observer is attached.
  //
  // Kept alive past the fill deadline on purpose. It used to stop after ten
  // seconds while the slot waited twelve, so an ad that arrived in between
  // was judged to have filled and then never reported a height — the slot
  // stayed at zero and the ad was there, invisible.
  var ticks = 0;
  var maxTicks = ${Math.ceil((timeoutMs + 5000) / 500)};
  var timer = setInterval(function () {
    report();
    if (++ticks > maxTicks) clearInterval(timer);
  }, 500);
})();
</script>
</body></html>`;
}


/** Which unit a frame request is for. The only input the route accepts. */
export type AdSlot = "desktop" | "mobile" | "native";

/**
 * Where a slot's document lives.
 *
 * A path on this site, not a data: or blob: URL, and that is the whole point:
 * those carry an opaque origin too, so they would land back on the failure
 * this route exists to escape.
 */
export function adFrameUrl(slot: AdSlot): string {
  return `/ads/frame?slot=${slot}`;
}

/** The unit a slot name refers to, or null when it is not configured. */
export function bannerForSlot(slot: AdSlot): AdsterraBanner | null {
  if (slot === "desktop") return DESKTOP_BANNER;
  if (slot === "mobile") return MOBILE_BANNER;
  return null;
}

/** What an ad frame is allowed to say to the page that hosts it. */
export type AdFrameMessage =
  | { type: "status"; filled: boolean; reason: "blocked" | "empty" | null }
  | { type: "height"; height: number };

/**
 * Reads one `message` event's payload, or null if it is not ours.
 *
 * Every field is checked rather than trusted. The frame's origin is opaque by
 * design, so there is no origin to compare against — the caller matches on
 * the frame's own `contentWindow`, which is the stronger test anyway, and
 * this covers the rest: a page can host other frames, extensions post into
 * pages, and neither should be able to tell a slot it filled.
 */
export function parseAdFrameMessage(data: unknown): AdFrameMessage | null {
  if (!data || typeof data !== "object") return null;
  const message = data as {
    source?: unknown;
    type?: unknown;
    filled?: unknown;
    reason?: unknown;
    height?: unknown;
  };
  if (message.source !== AD_MESSAGE_SOURCE) return null;
  if (message.type === "status" && typeof message.filled === "boolean") {
    const reason =
      message.reason === "blocked" || message.reason === "empty" ? message.reason : null;
    return { type: "status", filled: message.filled, reason };
  }
  if (message.type === "height" && typeof message.height === "number") {
    // A height that is not a real number would become a style nobody can see
    // past — NaN collapses the slot, Infinity swallows the page.
    if (!Number.isFinite(message.height) || message.height < 0) return null;
    return { type: "height", height: message.height };
  }
  return null;
}

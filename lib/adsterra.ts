
// The Adsterra slots, and the one decision that makes them safe to have.
//
// Both formats are third-party scripts, and the banner one is worse than
// that: it reads a *global* `atOptions` and paints itself with
// `document.write`. Neither survives contact with React — document.write
// after load replaces the whole document, and a global read at script-load
// time means two banners on a page race for the same variable.
//
// So neither runs on this page. Every slot is an `<iframe srcdoc>` holding
// exactly the snippet Adsterra hands out, and that solves three things at
// once: document.write writes into a fresh document where it is legal, the
// global belongs to one slot each, and — the part that actually matters —
// the iframe is sandboxed *without* `allow-same-origin`, so it runs on an
// opaque origin and cannot reach this site's localStorage. That storage holds
// the account's JWT (see accountApi.ts's getAccountToken), and an ad network's
// script running same-origin would be able to read it. Nothing about the
// revenue is worth that.
//
// The honest cost of the choice, so it is not a surprise later: some ad
// scripts touch `localStorage` unguarded, which *throws* on an opaque origin.
// If fill rate comes back at zero, this sandbox is the first suspect — see
// IFRAME_SANDBOX below.

/**
 * What the iframe is allowed to do.
 *
 *   allow-scripts .......... the ad is a script; without it nothing happens.
 *   allow-popups ........... a click on an ad opens a new tab.
 *   allow-popups-to-escape-sandbox
 *                           ... that tab is an ordinary tab rather than
 *                               another sandboxed one, which is what makes
 *                               the advertiser's page work.
 *   allow-forms ............ some creatives are forms.
 *
 * Deliberately absent: `allow-same-origin`. See the header — adding it hands
 * an ad network this origin, including the auth token in localStorage.
 */
export const IFRAME_SANDBOX =
  "allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms";

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
 * How long a slot waits for something to be drawn before calling itself
 * blocked.
 *
 * Only ever reached by the quiet failure. The loud one — an ad blocker
 * refusing the request outright — fires the script tag's `onerror` in
 * milliseconds, so the verdict there is effectively instant. This budget is
 * for the other kind: a blocker that answers with a neutered stub, so the
 * script "loads" fine and simply never paints. Long enough not to libel a
 * merely slow ad server, short enough that nobody sits looking at a hole.
 */
export const AD_FILL_TIMEOUT_MS = 3500;

/**
 * The half of an ad document that watches whether an ad turned up.
 *
 * Answering "did this fill?" cannot be done from outside: the frame has an
 * opaque origin precisely so the page cannot read into it, so the frame has
 * to say. And it cannot answer by trusting the script tag either — a blocker
 * that serves an empty stub produces a perfectly successful load with nothing
 * behind it. So the test is the only one that means anything: did a box with
 * real size get drawn.
 *
 * `onerror` on the tag itself is set as an inline attribute rather than
 * attached here, and that is load-bearing: a classic script that fails to
 * load dispatches its error while the parser is still blocked on it, which is
 * before this script exists to listen.
 */
function fillProbeScript(): string {
  return `<script>
(function () {
  var done = false;
  function tell(filled) {
    if (done) return;
    done = true;
    parent.postMessage({ source: "${AD_MESSAGE_SOURCE}", type: "status", filled: filled }, "*");
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
  var deadline = Date.now() + ${AD_FILL_TIMEOUT_MS};
  var timer = setInterval(function () {
    if (window.__adsterraBlocked) { clearInterval(timer); tell(false); return; }
    if (painted()) { clearInterval(timer); tell(true); return; }
    if (Date.now() > deadline) { clearInterval(timer); tell(false); }
  }, 150);
})();
</script>`;
}

/**
 * The document a banner slot runs in.
 *
 * This is Adsterra's snippet verbatim, plus a reset so the creative sits
 * flush against the iframe's edges. `atOptions` is assigned rather than
 * declared with const/let on purpose: their invoke.js reads it off the global
 * object, and a block-scoped binding would be invisible to it.
 */
export function bannerSrcDoc(banner: AdsterraBanner): string {
  const options = JSON.stringify({
    key: banner.key,
    format: "iframe",
    height: banner.height,
    width: banner.width,
    params: {},
  });
  return `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;padding:0;overflow:hidden;background:transparent}</style>
</head><body>
<script type="text/javascript">window.atOptions = ${options};</script>
<script type="text/javascript" src="${absoluteUrl(`${banner.domain}/${banner.key}/invoke.js`)}" onerror="window.__adsterraBlocked=1"></script>
${fillProbeScript()}
</body></html>`;
}

/**
 * The document a native slot runs in, plus the height it reports back.
 *
 * A native banner has no fixed size — it is a grid of cards whose height
 * depends on how many the script decides to draw. The parent cannot measure
 * it, because measuring across an opaque origin is exactly what the sandbox
 * forbids, so the iframe measures itself and posts the number out.
 * `postMessage` is the one channel that still works in both directions, and
 * the parent checks the message's shape before believing it.
 */
export function nativeSrcDoc(native: AdsterraNative): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:transparent}</style>
</head><body>
<div id="${native.containerId}"></div>
<script async data-cfasync="false" src="${absoluteUrl(native.src)}" onerror="window.__adsterraBlocked=1"></script>
${fillProbeScript()}
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
  if (window.ResizeObserver) new ResizeObserver(report).observe(document.documentElement);
  // A fallback for the first paints, because the script is async and may not
  // have drawn anything by the time the observer is attached.
  var ticks = 0;
  var timer = setInterval(function () {
    report();
    if (++ticks > 20) clearInterval(timer);
  }, 500);
})();
</script>
</body></html>`;
}

/** What an ad frame is allowed to say to the page that hosts it. */
export type AdFrameMessage =
  | { type: "status"; filled: boolean }
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
  const message = data as { source?: unknown; type?: unknown; filled?: unknown; height?: unknown };
  if (message.source !== AD_MESSAGE_SOURCE) return null;
  if (message.type === "status" && typeof message.filled === "boolean") {
    return { type: "status", filled: message.filled };
  }
  if (message.type === "height" && typeof message.height === "number") {
    // A height that is not a real number would become a style nobody can see
    // past — NaN collapses the slot, Infinity swallows the page.
    if (!Number.isFinite(message.height) || message.height < 0) return null;
    return { type: "height", height: message.height };
  }
  return null;
}

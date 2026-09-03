import assert from "node:assert/strict";
import {
  DEFAULT_BANNER_DOMAIN,
  bannerSrcDoc,
  nativeSrcDoc,
  parseAdFrameMessage,
  parseBanner,
  parseNative,
} from "./adsterra";

// A slot is configured or it is not — a half-configured one is a hole in the
// layout that Adsterra will never fill.
assert.equal(parseBanner(undefined, "728", "90", undefined), null);
assert.equal(parseBanner("abc", undefined, "90", undefined), null);
assert.equal(parseBanner("abc", "728", undefined, undefined), null);
assert.equal(parseBanner("abc", "nao-e-numero", "90", undefined), null);
assert.equal(parseBanner("abc", "0", "90", undefined), null);
assert.equal(parseBanner("abc", "-728", "90", undefined), null);

const banner = parseBanner("chave123", "728", "90", undefined);
assert.ok(banner);
assert.equal(banner.width, 728);
assert.equal(banner.height, 90);
assert.equal(banner.domain, DEFAULT_BANNER_DOMAIN);
assert.equal(parseBanner("k", "1", "1", "outro.host")?.domain, "outro.host");

// The banner document has to carry Adsterra's snippet exactly: the global
// they read, and a script tag pointing at the key's invoke.js.
const bannerDoc = bannerSrcDoc(banner);
assert.match(bannerDoc, /window\.atOptions = /);
assert.match(bannerDoc, /"key":"chave123"/);
assert.match(bannerDoc, /"format":"iframe"/);
assert.match(bannerDoc, /"width":728/);
assert.match(bannerDoc, /"height":90/);
assert.ok(bannerDoc.includes(`https://${DEFAULT_BANNER_DOMAIN}/chave123/invoke.js`));

// The one that would fail silently in production: a srcdoc document has an
// opaque origin, so a protocol-relative URL has no scheme to inherit. Every
// shape Adsterra hands out must come back absolute and https.
assert.ok(
  bannerSrcDoc({ ...banner, domain: "//www.exemplo.com" }).includes(
    "https://www.exemplo.com/chave123/invoke.js"
  )
);
assert.ok(
  bannerSrcDoc({ ...banner, domain: "https://www.exemplo.com" }).includes(
    "https://www.exemplo.com/chave123/invoke.js"
  )
);

// The native container id is derived from the key in the script path, so
// nobody has to keep two halves of one value in step.
assert.equal(parseNative(undefined, undefined), null);
const native = parseNative("//pl123.exemplo.com/abc123def/invoke.js", undefined);
assert.ok(native);
assert.equal(native.containerId, "container-abc123def");
assert.equal(
  parseNative("//pl123.exemplo.com/abc/invoke.js", "container-manual")?.containerId,
  "container-manual"
);
// A src with a query string still names its key.
assert.equal(
  parseNative("//pl1.exemplo.com/xyz789/invoke.js?v=2", undefined)?.containerId,
  "container-xyz789"
);

const nativeDoc = nativeSrcDoc(native);
assert.ok(nativeDoc.includes('<div id="container-abc123def">'));
assert.ok(nativeDoc.includes("https://pl123.exemplo.com/abc123def/invoke.js"));
// The height channel: without it the slot is stuck at its placeholder size,
// because the parent cannot measure across an opaque origin.
assert.match(nativeDoc, /type: "height"/);

// Both documents have to be able to say "nothing was drawn here", which is
// what puts the room's own ad back when a blocker is in the way. The inline
// onerror is the load-bearing half: a script that fails to load fires its
// error while the parser is still blocked on it, before any listener this
// document adds later could exist.
for (const doc of [bannerDoc, nativeDoc]) {
  assert.ok(doc.includes('onerror="window.__adsterraBlocked=1"'));
  assert.match(doc, /type: "status", filled: filled/);
  assert.match(doc, /getBoundingClientRect/);
}

// The parser is what stands between a slot and anything else on the page that
// can post a message — extensions, other frames, the ad's own creative.
assert.equal(parseAdFrameMessage(null), null);
assert.equal(parseAdFrameMessage("ola"), null);
assert.equal(parseAdFrameMessage({ type: "status", filled: true }), null, "sem source");
assert.equal(parseAdFrameMessage({ source: "outro", type: "status", filled: true }), null);
assert.equal(parseAdFrameMessage({ source: "adsterra", type: "status" }), null, "filled ausente");
assert.equal(
  parseAdFrameMessage({ source: "adsterra", type: "status", filled: "sim" }),
  null,
  "filled tem de ser boolean"
);
assert.deepEqual(parseAdFrameMessage({ source: "adsterra", type: "status", filled: false }), {
  type: "status",
  filled: false,
});
assert.deepEqual(parseAdFrameMessage({ source: "adsterra", type: "height", height: 320 }), {
  type: "height",
  height: 320,
});
// Uma altura que nao e numero real viraria um estilo que ninguem enxerga
// atras: NaN colapsa o slot, Infinity engole a pagina.
for (const height of [Number.NaN, Number.POSITIVE_INFINITY, -10, "320"]) {
  assert.equal(parseAdFrameMessage({ source: "adsterra", type: "height", height }), null);
}

console.log("adsterra: ok");

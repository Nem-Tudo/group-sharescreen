// Where a visitor is, roughly — read from what Cloudflare already sends with
// every request, so no lookup service and no change to the API. Used by the
// regional popup (lib/regional.ts), which asks only for people in its
// experiment.
//
// cf-ipcountry comes with Cloudflare's IP geolocation, on by default.
// cf-iplatitude / cf-iplongitude come only with the "Add visitor location
// headers" managed transform (dashboard → Rules → Settings → Managed
// Transforms). Without it the answer is just the country, and the browser
// falls back to a public lookup — see locateVisitor.
//
// The visitor gets back their own approximate position, rounded to ~1 km;
// nothing is stored here.

function coordinate(raw: string | null, limit: number): number | null {
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || Math.abs(value) > limit) return null;
  return Math.round(value * 100) / 100;
}

export function GET(request: Request) {
  const headers = request.headers;
  const country = (headers.get("cf-ipcountry") ?? "").trim().toUpperCase();
  const lat = coordinate(headers.get("cf-iplatitude"), 90);
  const lng = coordinate(headers.get("cf-iplongitude"), 180);
  const body = {
    // "XX" is Cloudflare's "no idea", "T1" is Tor: neither says anything.
    country: /^[A-Z]{2}$/.test(country) && country !== "XX" && country !== "T1" ? country : null,
    ...(lat !== null && lng !== null ? { lat, lng } : {}),
  };
  return Response.json(body, { headers: { "cache-control": "private, no-store" } });
}

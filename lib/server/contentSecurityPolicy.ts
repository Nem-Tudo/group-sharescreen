const NONCE = /^[A-Za-z0-9+/=_-]{16,128}$/u;

/** Builds the per-request CSP consumed by Next.js to nonce its own scripts. */
export function createContentSecurityPolicy(nonce: string, development: boolean): string {
  if (!NONCE.test(nonce)) throw new Error("invalid CSP nonce");
  const script = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    ...(development ? ["'unsafe-eval'"] : []),
    "https://challenges.cloudflare.com",
  ].join(" ");
  return [
    "default-src 'self'",
    `script-src ${script}`,
    "script-src-attr 'none'",
    // React/Next and a few interactive controls still emit bounded style
    // attributes. Script execution remains nonce-only; removing this style
    // exception is tracked separately from the XSS execution boundary.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "media-src 'self' blob: https://media.giphy.com https://media0.giphy.com https://media1.giphy.com https://media2.giphy.com https://media3.giphy.com https://media4.giphy.com",
    `connect-src 'self' ${development ? "ws://localhost:4000 http://localhost:4000 " : ""}https://challenges.cloudflare.com`,
    "frame-src https://challenges.cloudflare.com",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

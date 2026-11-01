"use client";

// The server's signed "this browser is still verified" (the API's
// captchaPass.ts), kept between page loads — fast-join-check.
//
// Only ever written from what the server said: it hands a pass out on
// "registered" and "room-state", together with how long it has left, and a
// join presents it back instead of minting a Turnstile token. Nothing here
// decides anything — a pass this browser holds that the server no longer
// accepts just costs one "captcha-required", after which it is dropped and the
// join retries with a real token.

const STORAGE_KEY = "sharescreen:captchaPass";
export const FAST_JOIN_CHECK_FEATURE = "fast-join-check";

// Treated as expired this long before the server would say so, so a join sent
// right at the edge is not refused in flight.
const EXPIRY_MARGIN_MS = 10_000;

interface StoredPass {
  pass: string;
  /** Local-clock expiry, worked out from the server's TTL on arrival. */
  until: number;
  /**
   * Who it was issued to, as this client knows them (an account username, or
   * "guest"). The server binds a pass to the account or device, so one held
   * across a login or a logout is certain to be refused — dropped here
   * instead, before it costs a "captcha-required".
   */
  owner: string;
}

function read(): StoredPass | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredPass>;
    if (typeof parsed.pass !== "string" || typeof parsed.until !== "number") return null;
    return { pass: parsed.pass, until: parsed.until, owner: typeof parsed.owner === "string" ? parsed.owner : "" };
  } catch {
    return null;
  }
}

/** Drops the stored pass when it belongs to somebody other than `owner`. */
export function syncCaptchaPassOwner(owner: string): void {
  const stored = read();
  if (stored && stored.owner !== owner) clearCaptchaPass();
}

/** The pass to present with a join, or null when there is none still good. */
export function readCaptchaPass(): string | null {
  const stored = read();
  if (!stored || Date.now() > stored.until - EXPIRY_MARGIN_MS) return null;
  return stored.pass;
}

export function hasFreshCaptchaPass(): boolean {
  return readCaptchaPass() !== null;
}

/** Stores a pass the server just handed out, valid for `ttlMs` from now. */
export function writeCaptchaPass(pass: string, ttlMs: number, owner: string): void {
  if (typeof window === "undefined" || !pass || !(ttlMs > 0)) return;
  try {
    const stored: StoredPass = { pass, until: Date.now() + ttlMs, owner };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // ignored - localStorage may be unavailable (private mode, quota, etc.)
  }
}

export function clearCaptchaPass(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignored
  }
}

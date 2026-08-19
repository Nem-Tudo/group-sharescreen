import { randomBytes, timingSafeEqual } from "node:crypto";

// Administration stays disabled until both credentials are configured.
const ADMIN_USER = process.env.ADMIN_USER || null;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || null;

export const ADMIN_ENABLED = Boolean(ADMIN_USER && ADMIN_PASSWORD);

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const tokens = new Map<string, number>();

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // timingSafeEqual requires equal-length buffers.
  const len = Math.max(bufA.length, bufB.length, 1);
  const paddedA = Buffer.alloc(len);
  const paddedB = Buffer.alloc(len);
  bufA.copy(paddedA);
  bufB.copy(paddedB);
  return bufA.length === bufB.length && timingSafeEqual(paddedA, paddedB);
}

// Verifies an `Authorization: Basic base64(user:pass)` header against the
// env-configured admin credentials.
export function checkBasicAuth(header: string | undefined): boolean {
  if (!ADMIN_ENABLED || !header?.startsWith("Basic ")) return false;
  let decoded: string;
  try {
    decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  } catch {
    return false;
  }
  const sep = decoded.indexOf(":");
  if (sep === -1) return false;
  const user = decoded.slice(0, sep);
  const pass = decoded.slice(sep + 1);
  return safeEqual(user, ADMIN_USER!) && safeEqual(pass, ADMIN_PASSWORD!);
}

export function createAdminToken(): string {
  const token = randomBytes(24).toString("base64url");
  tokens.set(token, Date.now() + TOKEN_TTL_MS);
  return token;
}

export function verifyAdminToken(token: string | null | undefined): boolean {
  if (!ADMIN_ENABLED || !token) return false;
  const expiresAt = tokens.get(token);
  if (!expiresAt) return false;
  if (expiresAt < Date.now()) {
    tokens.delete(token);
    return false;
  }
  return true;
}

export function revokeAdminToken(token: string): void {
  tokens.delete(token);
}

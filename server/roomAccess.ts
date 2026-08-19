import { randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    nodeScrypt(
      password,
      salt,
      SCRYPT_KEY_LENGTH,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAX_MEMORY },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey as Buffer);
      }
    );
  });
}

export async function hashRoomPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = await deriveKey(password, salt);
  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64url"),
    derivedKey.toString("base64url"),
  ].join("$");
}

export async function verifyRoomPassword(password: string, encodedHash: string): Promise<boolean> {
  try {
    const [algorithm, n, r, p, saltEncoded, keyEncoded, extra] = encodedHash.split("$");
    if (
      algorithm !== "scrypt" ||
      extra !== undefined ||
      Number(n) !== SCRYPT_N ||
      Number(r) !== SCRYPT_R ||
      Number(p) !== SCRYPT_P
    ) {
      return false;
    }
    const salt = Buffer.from(saltEncoded, "base64url");
    const expected = Buffer.from(keyEncoded, "base64url");
    if (salt.length !== 16 || expected.length !== SCRYPT_KEY_LENGTH) return false;
    const actual = await deriveKey(password, salt);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

type RoomGrant = {
  room: string;
  expiresAt: number;
};

export class RoomAccessTokens {
  private readonly grants = new Map<string, RoomGrant>();
  private readonly ttlMs: number;

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  issue(room: string, now = Date.now()): { accessToken: string; expiresAt: number } {
    this.prune(now);
    const accessToken = randomBytes(32).toString("base64url");
    const expiresAt = now + this.ttlMs;
    this.grants.set(accessToken, { room, expiresAt });
    return { accessToken, expiresAt };
  }

  validate(room: string, accessToken: string, now = Date.now()): boolean {
    const grant = this.grants.get(accessToken);
    if (!grant) return false;
    if (grant.expiresAt <= now) {
      this.grants.delete(accessToken);
      return false;
    }
    return grant.room === room;
  }

  invalidateRoom(room: string) {
    for (const [token, grant] of this.grants) {
      if (grant.room === room) this.grants.delete(token);
    }
  }

  prune(now = Date.now()) {
    for (const [token, grant] of this.grants) {
      if (grant.expiresAt <= now) this.grants.delete(token);
    }
  }
}

type AttemptWindow = {
  count: number;
  resetAt: number;
};

export class RoomAuthRateLimiter {
  private readonly attempts = new Map<string, AttemptWindow>();
  private readonly maxAttempts: number;
  private readonly windowMs: number;

  constructor(maxAttempts: number, windowMs: number) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
  }

  check(key: string, now = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
    const current = this.attempts.get(key);
    if (!current || current.resetAt <= now) return { allowed: true, retryAfterSeconds: 0 };
    return {
      allowed: current.count < this.maxAttempts,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }

  recordFailure(key: string, now = Date.now()) {
    const current = this.attempts.get(key);
    if (!current || current.resetAt <= now) {
      this.attempts.set(key, { count: 1, resetAt: now + this.windowMs });
      return;
    }
    current.count += 1;
  }

  clear(key: string) {
    this.attempts.delete(key);
  }
}

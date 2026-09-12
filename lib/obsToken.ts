
import { translate } from "@/lib/i18n";// Token de segurança assinado para links de OBS (Browser Source).
// Usa HMAC-SHA256 com a Web Crypto API padrão (disponível em browsers, OBS Studio e Node.js 18+).

const OBS_TOKEN_SECRET =
  process.env.NEXT_PUBLIC_OBS_TOKEN_SECRET ||
  "golive-obs-secure-token-secret-key-2026";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export interface ObsTokenPayload {
  room: string;
  target?: string;
  authorId: string;
  authorName?: string;
  iat: number;
  exp: number;
}

function base64UrlEncode(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) {
    base64 += "=";
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// SHA-256 constants for pure JS fallback (used when crypto.subtle is unavailable in non-secure HTTP contexts)
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(n: number, b: number): number {
  return (n >>> b) | (n << (32 - b));
}

function sha256Fallback(data: Uint8Array): Uint8Array {
  const byteLen = data.length;
  const extra = (byteLen + 9) % 64;
  const padLen = extra === 0 ? 0 : 64 - extra;
  const totalLen = byteLen + 1 + padLen + 8;
  const msg = new Uint8Array(totalLen);
  msg.set(data);
  msg[byteLen] = 0x80;

  const view = new DataView(msg.buffer, msg.byteOffset, totalLen);
  const bitLenHi = Math.floor((byteLen * 8) / 0x100000000);
  const bitLenLo = (byteLen * 8) >>> 0;
  view.setUint32(totalLen - 8, bitLenHi, false);
  view.setUint32(totalLen - 4, bitLenLo, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);

  for (let i = 0; i < totalLen; i += 64) {
    for (let j = 0; j < 16; j++) {
      w[j] = view.getUint32(i + j * 4, false);
    }
    for (let j = 16; j < 64; j++) {
      const s0 = rotr(w[j - 15], 7) ^ rotr(w[j - 15], 18) ^ (w[j - 15] >>> 3);
      const s1 = rotr(w[j - 2], 17) ^ rotr(w[j - 2], 19) ^ (w[j - 2] >>> 10);
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let j = 0; j < 64; j++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[j] + w[j]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + h) | 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, h0, false);
  outView.setUint32(4, h1, false);
  outView.setUint32(8, h2, false);
  outView.setUint32(12, h3, false);
  outView.setUint32(16, h4, false);
  outView.setUint32(20, h5, false);
  outView.setUint32(24, h6, false);
  outView.setUint32(28, h7, false);
  return out;
}

function hmacSha256Fallback(keyBytes: Uint8Array, messageBytes: Uint8Array): Uint8Array {
  const blockSize = 64;
  let key = keyBytes;
  if (key.length > blockSize) {
    key = sha256Fallback(key);
  }
  const kPad = new Uint8Array(blockSize);
  kPad.set(key);

  const iPad = new Uint8Array(blockSize + messageBytes.length);
  const oPad = new Uint8Array(blockSize + 32);

  for (let i = 0; i < blockSize; i++) {
    iPad[i] = kPad[i] ^ 0x36;
    oPad[i] = kPad[i] ^ 0x5c;
  }
  iPad.set(messageBytes, blockSize);

  const innerHash = sha256Fallback(iPad);
  oPad.set(innerHash, blockSize);

  return sha256Fallback(oPad);
}

// Uses crypto.subtle in secure contexts, with automatic pure JS fallback
// for non-secure contexts (e.g. accessing via LAN IP http://100.101.38.69:3000)
async function computeHmacSignature(secret: string, dataStr: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const secretBytes = enc.encode(secret);
  const dataBytes = enc.encode(dataStr);

  const subtle = typeof crypto !== "undefined" && crypto?.subtle ? crypto.subtle : null;
  if (subtle) {
    try {
      const key = await subtle.importKey(
        "raw",
        secretBytes,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      const sigBuffer = await subtle.sign("HMAC", key, dataBytes);
      return new Uint8Array(sigBuffer);
    } catch {
      // Fall through to fallback
    }
  }

  return hmacSha256Fallback(secretBytes, dataBytes);
}

async function verifyHmacSignature(
  secret: string,
  dataStr: string,
  sigBytes: Uint8Array
): Promise<boolean> {
  const expectedBytes = await computeHmacSignature(secret, dataStr);
  if (expectedBytes.length !== sigBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < expectedBytes.length; i++) {
    diff |= expectedBytes[i] ^ sigBytes[i];
  }
  return diff === 0;
}

/**
 * Gera um token assinado para a sala, target e autor informados.
 * Retorna o token no formato: <payloadB64>.<signatureB64>
 */
export async function createObsSecurityToken(
  room: string,
  target = "",
  authorId: string,
  authorName?: string
): Promise<string> {
  if (!authorId || typeof authorId !== "string" || !authorId.trim()) {
    throw new Error(translate("obsToken.authoridIsRequiredToGenerateThe"));
  }

  const payload: ObsTokenPayload = {
    room: room.trim().toLowerCase(),
    target: target.trim(),
    authorId: authorId.trim(),
    authorName: authorName?.trim(),
    iat: Date.now(),
    exp: Date.now() + SEVEN_DAYS_MS,
  };

  const payloadStr = JSON.stringify(payload);
  const enc = new TextEncoder();
  const payloadBytes = enc.encode(payloadStr);
  const payloadB64 = base64UrlEncode(payloadBytes);

  const signatureBytes = await computeHmacSignature(OBS_TOKEN_SECRET, payloadB64);
  const sigB64 = base64UrlEncode(signatureBytes);

  return `${payloadB64}.${sigB64}`;
}

/**
 * Valida um token de OBS. Verifica a assinatura HMAC, se não expirou, pertence à sala e tem autor.
 */
export async function verifyObsSecurityToken(
  token: string | null | undefined,
  expectedRoom: string
): Promise<{ valid: boolean; payload?: ObsTokenPayload; error?: string }> {
  if (!token || typeof token !== "string") {
    return { valid: false, error: translate("common.tokenNotProvided") };
  }

  const parts = token.trim().split(".");
  if (parts.length !== 2) {
    return { valid: false, error: translate("obsToken.invalidTokenFormat") };
  }

  const [payloadB64, sigB64] = parts;

  try {
    const sigBytes = base64UrlDecode(sigB64);
    const isValidSig = await verifyHmacSignature(OBS_TOKEN_SECRET, payloadB64, sigBytes);

    if (!isValidSig) {
      return { valid: false, error: translate("obsToken.invalidTokenSignature") };
    }

    const payloadBytes = base64UrlDecode(payloadB64);
    const payloadStr = new TextDecoder().decode(payloadBytes);
    const payload = JSON.parse(payloadStr) as ObsTokenPayload;

    if (payload.room !== expectedRoom.trim().toLowerCase()) {
      return { valid: false, error: translate("obsToken.tokenDoesNotBelongToThis") };
    }

    if (!payload.authorId || typeof payload.authorId !== "string" || !payload.authorId.trim()) {
      return { valid: false, error: translate("obsToken.tokenWithNoAuthorIdentification") };
    }

    if (Date.now() > payload.exp) {
      return { valid: false, error: translate("obsToken.tokenExpired") };
    }

    return { valid: true, payload };
  } catch {
    return { valid: false, error: translate("obsToken.errorProcessingTheSecurityToken") };
  }
}

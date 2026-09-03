// Token de segurança assinado para links de OBS (Browser Source).
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

async function getCryptoKey(): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    enc.encode(OBS_TOKEN_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
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
    throw new Error("authorId é obrigatório para gerar o token de transmissão.");
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

  const key = await getCryptoKey();
  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode(payloadB64)
  );
  const sigB64 = base64UrlEncode(signatureBuffer);

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
    return { valid: false, error: "Token não fornecido." };
  }

  const parts = token.trim().split(".");
  if (parts.length !== 2) {
    return { valid: false, error: "Formato de token inválido." };
  }

  const [payloadB64, sigB64] = parts;

  try {
    const key = await getCryptoKey();
    const enc = new TextEncoder();
    const sigBytes = base64UrlDecode(sigB64);

    const isValidSig = await crypto.subtle.verify(
      "HMAC",
      key,
      sigBytes as unknown as BufferSource,
      enc.encode(payloadB64) as unknown as BufferSource
    );

    if (!isValidSig) {
      return { valid: false, error: "Assinatura do token inválida." };
    }

    const payloadBytes = base64UrlDecode(payloadB64);
    const payloadStr = new TextDecoder().decode(payloadBytes);
    const payload = JSON.parse(payloadStr) as ObsTokenPayload;

    if (payload.room !== expectedRoom.trim().toLowerCase()) {
      return { valid: false, error: "Token não pertence a esta sala." };
    }

    if (!payload.authorId || typeof payload.authorId !== "string" || !payload.authorId.trim()) {
      return { valid: false, error: "Token sem identificação do autor." };
    }

    if (Date.now() > payload.exp) {
      return { valid: false, error: "Token expirado." };
    }

    return { valid: true, payload };
  } catch {
    return { valid: false, error: "Erro ao processar o token de segurança." };
  }
}

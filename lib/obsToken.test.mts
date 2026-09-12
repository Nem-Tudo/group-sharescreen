import test from "node:test";
import assert from "node:assert/strict";
import { createObsSecurityToken, verifyObsSecurityToken } from "./obsToken";

test("obsToken: gera e valida token assinado com sucesso", async () => {
  const room = "sala-teste";
  const target = "screen:peer-123";
  const authorId = "user-admin-456";
  const authorName = "AdminTiago";
  const token = await createObsSecurityToken(room, target, authorId, authorName);

  assert.ok(token, "token deve existir");
  assert.ok(token.includes("."), "token deve conter separador de payload e assinatura");

  const result = await verifyObsSecurityToken(token, room);
  assert.equal(result.valid, true, "token deve ser válido");
  assert.equal(result.payload?.room, room);
  assert.equal(result.payload?.target, target);
  assert.equal(result.payload?.authorId, authorId);
  assert.equal(result.payload?.authorName, authorName);
});

test("obsToken: rejects a token for a different room", async () => {
  const token = await createObsSecurityToken("sala-original", "screen:peer-1", "user-1");
  const result = await verifyObsSecurityToken(token, "sala-diferente");

  assert.equal(result.valid, false);
  assert.match(result.error ?? "", /does not belong to this room/i);
});

test("obsToken: rejects a tampered token", async () => {
  const token = await createObsSecurityToken("minha-sala", "screen:peer-1", "user-1");
  const [payloadB64, sigB64] = token.split(".");

  // Tamper with the payload
  const tamperedPayload = payloadB64.slice(0, -2) + "==";
  const result = await verifyObsSecurityToken(`${tamperedPayload}.${sigB64}`, "minha-sala");

  assert.equal(result.valid, false);
});

test("obsToken: rejects generation without an authorId", async () => {
  await assert.rejects(async () => {
    await createObsSecurityToken("sala", "target", "");
  }, /authorId is required/i);
});

test("obsToken: rejects a null or empty token", async () => {
  const resultNull = await verifyObsSecurityToken(null, "sala");
  assert.equal(resultNull.valid, false);

  const resultEmpty = await verifyObsSecurityToken("", "sala");
  assert.equal(resultEmpty.valid, false);
});

test("obsToken: funciona perfeitamente em contexto HTTP não-seguro (sem crypto.subtle)", async () => {
  const originalSubtle = globalThis.crypto?.subtle;
  try {
    // Simula navegador em contexto não seguro (HTTP via IP) onde crypto.subtle é undefined
    Object.defineProperty(globalThis.crypto, "subtle", {
      value: undefined,
      configurable: true,
    });

    const room = "sala-ip-local";
    const target = "camera:user-1";
    const authorId = "user-local-100";

    const token = await createObsSecurityToken(room, target, authorId, "UserLocal");
    assert.ok(token);

    const result = await verifyObsSecurityToken(token, room);
    assert.equal(result.valid, true);
    assert.equal(result.payload?.room, room);
    assert.equal(result.payload?.target, target);
    assert.equal(result.payload?.authorId, authorId);
  } finally {
    if (originalSubtle) {
      Object.defineProperty(globalThis.crypto, "subtle", {
        value: originalSubtle,
        configurable: true,
      });
    }
  }
});



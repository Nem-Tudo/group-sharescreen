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

test("obsToken: rejeita token para sala diferente", async () => {
  const token = await createObsSecurityToken("sala-original", "screen:peer-1", "user-1");
  const result = await verifyObsSecurityToken(token, "sala-diferente");

  assert.equal(result.valid, false);
  assert.match(result.error ?? "", /não pertence a esta sala/i);
});

test("obsToken: rejeita token adulterado", async () => {
  const token = await createObsSecurityToken("minha-sala", "screen:peer-1", "user-1");
  const [payloadB64, sigB64] = token.split(".");

  // Modifica o payload
  const tamperedPayload = payloadB64.slice(0, -2) + "==";
  const result = await verifyObsSecurityToken(`${tamperedPayload}.${sigB64}`, "minha-sala");

  assert.equal(result.valid, false);
});

test("obsToken: rejeita geração sem authorId", async () => {
  await assert.rejects(async () => {
    await createObsSecurityToken("sala", "target", "");
  }, /authorId é obrigatório/i);
});

test("obsToken: rejeita token nulo ou vazio", async () => {
  const resultNull = await verifyObsSecurityToken(null, "sala");
  assert.equal(resultNull.valid, false);

  const resultEmpty = await verifyObsSecurityToken("", "sala");
  assert.equal(resultEmpty.valid, false);
});


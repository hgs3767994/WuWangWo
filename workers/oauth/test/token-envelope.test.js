import assert from "node:assert/strict";
import test from "node:test";
import { decryptTokenEnvelope, encryptTokenEnvelope } from "../src/token-envelope.js";

test("token envelope encrypts opaque token data", async () => {
  const value = { refresh_token: "secret-token", scope: "drive.appdata" };
  const envelope = await encryptTokenEnvelope(value, "encryption-secret");
  assert(!envelope.ciphertext.includes("secret-token"));
  assert.deepEqual(await decryptTokenEnvelope(envelope, "encryption-secret"), value);
  await assert.rejects(() => decryptTokenEnvelope(envelope, "wrong-secret"));
});

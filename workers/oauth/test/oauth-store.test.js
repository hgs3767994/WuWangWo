import assert from "node:assert/strict";
import test from "node:test";
import { saveAccount } from "../src/oauth-store.js";
test("account storage binds encrypted fields instead of token plaintext", async () => {
  let values; const db = { prepare: () => ({ bind: (...args) => (values = args, { run: async () => {} }) }) };
  await saveAccount(db, { subject: "sub", envelope: { ciphertext: "cipher", iv: "iv" }, scopes: "scope", expiresAt: "2030", refreshTokenPresent: true, now: "2026" });
  assert.deepEqual(values, ["sub", "cipher", "iv", "scope", "2030", 1, "2026", "2026"]);
});

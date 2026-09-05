import assert from "node:assert/strict";
import test from "node:test";
import { consumeHandoff, createSession, revokeSession, saveAccount } from "../src/oauth-store.js";
test("account storage binds encrypted fields instead of token plaintext", async () => {
  let values; const db = { prepare: () => ({ bind: (...args) => (values = args, { run: async () => {} }) }) };
  await saveAccount(db, { subject: "sub", envelope: { ciphertext: "cipher", iv: "iv" }, scopes: "scope", expiresAt: "2030", refreshTokenPresent: true, now: "2026" });
  assert.deepEqual(values, ["sub", "cipher", "iv", "scope", "2030", 1, "2026", "2026"]);
});

test("handoff consumption is single-use and sessions are stored hashed", async () => {
  const calls = [];
  const database = {
    prepare(query) {
      return {
        bind(...values) {
          calls.push({ query, values });
          return {
            first: async () => query.startsWith("UPDATE oauth_handoffs") ? { google_subject: "subject-1" } : null,
            run: async () => ({})
          };
        }
      };
    }
  };
  assert.equal(await consumeHandoff(database, { code: "handoff-code", now: "2026-09-04T00:00:00.000Z" }), "subject-1");
  const session = await createSession(database, { token: "session-token", subject: "subject-1", now: "2026-09-04T00:00:00.000Z" });
  assert.equal(session.expiresAt, "2026-09-04T01:00:00.000Z");
  assert(calls.some(({ query, values }) => query.includes("oauth_sessions") && !values.includes("session-token")));
});

test("session revocation stores only a token hash", async () => {
  let captured;
  const database = {
    prepare(query) {
      return {
        bind(...values) {
          captured = { query, values };
          return { first: async () => ({ google_subject: "subject-1" }) };
        }
      };
    }
  };
  assert.equal(await revokeSession(database, { token: "session-token", now: "2026-09-05T00:00:00.000Z" }), true);
  assert.match(captured.query, /UPDATE oauth_sessions SET revoked_at/);
  assert(!captured.values.includes("session-token"));
});

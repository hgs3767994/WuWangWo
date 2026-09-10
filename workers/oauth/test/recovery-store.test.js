import assert from "node:assert/strict";
import test from "node:test";
import { approveRecoveryRequest, completeRecoveryRequest, createRecoveryRequest, recordFailedVerification } from "../src/recovery-store.js";

function capturingDatabase(firstResult = {}) {
  const captured = [];
  return {
    captured,
    prepare(query) {
      return {
        bind(...values) {
          captured.push({ query, values });
          return { run: async () => ({}), first: async () => firstResult, all: async () => ({ results: [] }) };
        }
      };
    }
  };
}

test("Recovery v3 requests include only a public key and expire after five minutes", async () => {
  const database = capturingDatabase();
  const request = await createRecoveryRequest(database, {
    requestId: "request-id", subject: "google-subject", vaultId: "vault-id", requesterDeviceId: "device-id", pairingCode: "PAIR-123",
    requesterPublicKey: { kty: "RSA", n: "public", e: "AQAB", alg: "RSA-OAEP-256" }, baseSessionEpoch: 2, now: "2026-09-05T00:00:00.000Z"
  });
  assert.equal(request.expiresAt, "2026-09-05T00:05:00.000Z");
  const insert = database.captured.find(({ query }) => query.includes("INSERT INTO recovery_requests"));
  assert(insert);
  assert(!insert.query.includes("password"));
  assert(!insert.query.includes("dek"));
});

test("approval atomically publishes only a sealed transfer envelope for the matching epoch", async () => {
  const database = capturingDatabase({ request_id: "request-id", status: "transfer_ready" });
  const request = await approveRecoveryRequest(database, {
    requestId: "request-id", subject: "google-subject", approverDeviceId: "old-device", sessionEpoch: 2,
    transferEnvelope: { version: 1, algorithm: "RSA-OAEP-256", ciphertext: "sealed" }, verificationCodeHash: "hash", verificationCodeSalt: "salt", now: "2026-09-05T00:00:00.000Z"
  });
  assert.equal(request.status, "transfer_ready");
  const update = database.captured.find(({ query }) => query.includes("transfer_envelope = ?"));
  assert.match(update.query, /status = 'pending'/);
  assert.match(update.query, /base_session_epoch = \?/);
  assert.equal(update.values[3], "2026-09-05T00:05:00.000Z");
});

test("verification attempts lock a request and completion removes the sealed envelope", async () => {
  const failedDb = capturingDatabase({ verification_attempts: 5, status: "expired" });
  const failed = await recordFailedVerification(failedDb, { requestId: "request-id", subject: "google-subject" });
  assert.equal(failed.status, "expired");
  assert.match(failedDb.captured[0].query, /verification_attempts \+ 1 >=/);

  const completedDb = capturingDatabase({ request_id: "request-id", status: "completed" });
  const completed = await completeRecoveryRequest(completedDb, { requestId: "request-id", subject: "google-subject", baseSessionEpoch: 2, completedSessionEpoch: 3, now: "2026-09-05T00:02:00.000Z" });
  assert.equal(completed.status, "completed");
  assert.match(completedDb.captured[0].query, /transfer_envelope = NULL/);
});

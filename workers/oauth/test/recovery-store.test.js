import assert from "node:assert/strict";
import test from "node:test";
import { approveRecoveryRequest, createRecoveryRequest } from "../src/recovery-store.js";

test("recovery requests contain routing metadata only and expire after ten minutes", async () => {
  let captured;
  const database = { prepare: (query) => ({ bind: (...values) => (captured = { query, values }, { run: async () => {} }) }) };
  const request = await createRecoveryRequest(database, {
    requestId: "request-id", subject: "google-subject", vaultId: "vault-id", requesterDeviceId: "device-id", pairingCode: "PAIR-123", now: "2026-09-05T00:00:00.000Z"
  });
  assert.equal(request.expiresAt, "2026-09-05T00:10:00.000Z");
  assert.match(captured.query, /INSERT INTO recovery_requests/);
  assert(!captured.query.includes("password"));
  assert(!captured.query.includes("dek"));
});

test("approval is atomic and only applies to an unexpired pending request", async () => {
  let captured;
  const database = { prepare: (query) => ({ bind: (...values) => (captured = { query, values }, { first: async () => ({ request_id: "request-id", status: "approved" }) }) }) };
  const request = await approveRecoveryRequest(database, {
    requestId: "request-id", subject: "google-subject", approverDeviceId: "old-device", sessionEpoch: 2, now: "2026-09-05T00:00:00.000Z"
  });
  assert.equal(request.status, "approved");
  assert.match(captured.query, /status = 'pending' AND expires_at >/);
});

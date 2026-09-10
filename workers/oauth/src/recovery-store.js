const REQUEST_TTL_MS = 5 * 60 * 1000;
const MAX_VERIFICATION_ATTEMPTS = 5;

async function expireRequests(database, subject, now, requestId = null) {
  const query = requestId
    ? "UPDATE recovery_requests SET status = 'expired' WHERE request_id = ? AND google_subject = ? AND status IN ('pending', 'transfer_ready') AND expires_at <= ?"
    : "UPDATE recovery_requests SET status = 'expired' WHERE google_subject = ? AND status IN ('pending', 'transfer_ready') AND expires_at <= ?";
  const values = requestId ? [requestId, subject, now] : [subject, now];
  await database.prepare(query).bind(...values).run();
}

export async function createRecoveryRequest(database, { requestId, subject, vaultId, requesterDeviceId, pairingCode, requesterPublicKey, baseSessionEpoch, now }) {
  const expiresAt = new Date(new Date(now).getTime() + REQUEST_TTL_MS).toISOString();
  await expireRequests(database, subject, now);
  await database
    .prepare("UPDATE recovery_requests SET status = 'cancelled' WHERE google_subject = ? AND vault_id = ? AND status IN ('pending', 'transfer_ready')")
    .bind(subject, vaultId)
    .run();
  await database
    .prepare(`INSERT INTO recovery_requests (request_id, google_subject, vault_id, requester_device_id, requester_public_key, pairing_code, base_session_epoch, status, expires_at, verification_code_hash, verification_code_salt, verification_attempts, transfer_envelope, approved_at, approved_by_device_id, approved_session_epoch, completed_at, completed_session_epoch, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL, NULL, 0, NULL, NULL, NULL, NULL, NULL, NULL, ?)`)
    .bind(requestId, subject, vaultId, requesterDeviceId, JSON.stringify(requesterPublicKey), pairingCode, baseSessionEpoch, expiresAt, now)
    .run();
  return { requestId, expiresAt, status: "pending" };
}

export async function listRecoveryRequests(database, { subject, now }) {
  await expireRequests(database, subject, now);
  const rows = await database
    .prepare(`SELECT request_id, vault_id, requester_device_id, requester_public_key, pairing_code, base_session_epoch, status, expires_at, created_at
      FROM recovery_requests WHERE google_subject = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 20`)
    .bind(subject)
    .all();
  return rows.results ?? [];
}

export async function recoveryRequest(database, { requestId, subject, now }) {
  await expireRequests(database, subject, now, requestId);
  return database
    .prepare(`SELECT request_id, vault_id, requester_device_id, pairing_code, base_session_epoch, status, expires_at, approved_at, approved_by_device_id, approved_session_epoch, completed_at, completed_session_epoch, created_at
      FROM recovery_requests WHERE request_id = ? AND google_subject = ?`)
    .bind(requestId, subject)
    .first();
}

export async function approveRecoveryRequest(database, { requestId, subject, approverDeviceId, sessionEpoch, transferEnvelope, verificationCodeHash, verificationCodeSalt, now }) {
  await expireRequests(database, subject, now, requestId);
  const verificationExpiresAt = new Date(new Date(now).getTime() + REQUEST_TTL_MS).toISOString();
  return database
    .prepare(`UPDATE recovery_requests SET status = 'transfer_ready', transfer_envelope = ?, verification_code_hash = ?, verification_code_salt = ?, verification_attempts = 0, expires_at = ?, approved_at = ?, approved_by_device_id = ?, approved_session_epoch = ?
      WHERE request_id = ? AND google_subject = ? AND status = 'pending' AND expires_at > ? AND base_session_epoch = ?
      RETURNING request_id, vault_id, requester_device_id, pairing_code, status, expires_at, approved_at, approved_by_device_id, approved_session_epoch`)
    .bind(JSON.stringify(transferEnvelope), verificationCodeHash, verificationCodeSalt, verificationExpiresAt, now, approverDeviceId, sessionEpoch, requestId, subject, now, sessionEpoch)
    .first();
}

export async function recoveryVerificationRecord(database, { requestId, subject, now }) {
  await expireRequests(database, subject, now, requestId);
  return database
    .prepare(`SELECT request_id, status, expires_at, verification_code_hash, verification_code_salt, verification_attempts, transfer_envelope, base_session_epoch
      FROM recovery_requests WHERE request_id = ? AND google_subject = ?`)
    .bind(requestId, subject)
    .first();
}

export async function recordFailedVerification(database, { requestId, subject }) {
  return database
    .prepare(`UPDATE recovery_requests
      SET verification_attempts = verification_attempts + 1,
          status = CASE WHEN verification_attempts + 1 >= ? THEN 'expired' ELSE status END
      WHERE request_id = ? AND google_subject = ? AND status = 'transfer_ready'
      RETURNING verification_attempts, status`)
    .bind(MAX_VERIFICATION_ATTEMPTS, requestId, subject)
    .first();
}

export async function completeRecoveryRequest(database, { requestId, subject, baseSessionEpoch, completedSessionEpoch, now }) {
  return database
    .prepare(`UPDATE recovery_requests SET status = 'completed', completed_at = ?, completed_session_epoch = ?, transfer_envelope = NULL, verification_code_hash = NULL, verification_code_salt = NULL
      WHERE request_id = ? AND google_subject = ? AND status = 'transfer_ready' AND expires_at > ? AND base_session_epoch = ?
      RETURNING request_id, status, completed_at, completed_session_epoch`)
    .bind(now, completedSessionEpoch, requestId, subject, now, baseSessionEpoch)
    .first();
}

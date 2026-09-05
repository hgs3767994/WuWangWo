const REQUEST_TTL_MS = 10 * 60 * 1000;

export async function createRecoveryRequest(database, { requestId, subject, vaultId, requesterDeviceId, pairingCode, now }) {
  const expiresAt = new Date(new Date(now).getTime() + REQUEST_TTL_MS).toISOString();
  await database
    .prepare(`INSERT INTO recovery_requests (request_id, google_subject, vault_id, requester_device_id, pairing_code, status, expires_at, approved_at, approved_by_device_id, approved_session_epoch, created_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, NULL, NULL, NULL, ?)`)
    .bind(requestId, subject, vaultId, requesterDeviceId, pairingCode, expiresAt, now)
    .run();
  return { requestId, expiresAt, status: "pending" };
}

export async function listRecoveryRequests(database, { subject, now }) {
  await database.prepare("UPDATE recovery_requests SET status = 'expired' WHERE google_subject = ? AND status = 'pending' AND expires_at <= ?").bind(subject, now).run();
  const rows = await database
    .prepare(`SELECT request_id, vault_id, requester_device_id, pairing_code, status, expires_at, approved_at, approved_by_device_id, approved_session_epoch, created_at
      FROM recovery_requests WHERE google_subject = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 20`)
    .bind(subject)
    .all();
  return rows.results ?? [];
}

export async function recoveryRequest(database, { requestId, subject, now }) {
  await database.prepare("UPDATE recovery_requests SET status = 'expired' WHERE request_id = ? AND google_subject = ? AND status = 'pending' AND expires_at <= ?").bind(requestId, subject, now).run();
  return database
    .prepare(`SELECT request_id, vault_id, requester_device_id, pairing_code, status, expires_at, approved_at, approved_by_device_id, approved_session_epoch, created_at
      FROM recovery_requests WHERE request_id = ? AND google_subject = ?`)
    .bind(requestId, subject)
    .first();
}

export async function approveRecoveryRequest(database, { requestId, subject, approverDeviceId, sessionEpoch, now }) {
  return database
    .prepare(`UPDATE recovery_requests SET status = 'approved', approved_at = ?, approved_by_device_id = ?, approved_session_epoch = ?
      WHERE request_id = ? AND google_subject = ? AND status = 'pending' AND expires_at > ? RETURNING request_id, vault_id, requester_device_id, pairing_code, status, expires_at, approved_at, approved_by_device_id, approved_session_epoch`)
    .bind(now, approverDeviceId, sessionEpoch, requestId, subject, now)
    .first();
}

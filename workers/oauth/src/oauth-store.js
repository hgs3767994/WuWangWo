const DEVICE_SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export async function saveAccount(database, { subject, envelope, scopes, expiresAt, refreshTokenPresent, now }) {
  await database.prepare(`INSERT INTO oauth_accounts (google_subject, token_ciphertext, token_iv, scopes, token_expires_at, refresh_token_present, created_at, updated_at, revoked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(google_subject) DO UPDATE SET token_ciphertext = excluded.token_ciphertext, token_iv = excluded.token_iv, scopes = excluded.scopes, token_expires_at = excluded.token_expires_at, refresh_token_present = excluded.refresh_token_present, updated_at = excluded.updated_at, revoked_at = NULL`)
    .bind(subject, envelope.ciphertext, envelope.iv, scopes, expiresAt, refreshTokenPresent ? 1 : 0, now, now).run();
}

export async function accountBySubject(database, { subject }) {
  return database
    .prepare("SELECT google_subject, token_ciphertext, token_iv, scopes, token_expires_at, refresh_token_present FROM oauth_accounts WHERE google_subject = ? AND revoked_at IS NULL")
    .bind(subject)
    .first();
}

export async function createHandoff(database, { code, subject, now }) {
  const hash = await sha256(code);
  const expiresAt = new Date(new Date(now).getTime() + 2 * 60 * 1000).toISOString();
  await database.prepare("INSERT INTO oauth_handoffs (handoff_hash, google_subject, expires_at, consumed_at, created_at) VALUES (?, ?, ?, NULL, ?)").bind(hash, subject, expiresAt, now).run();
  return { code, expiresAt };
}

export async function consumeHandoff(database, { code, now }) {
  const hash = await sha256(code);
  const row = await database
    .prepare("UPDATE oauth_handoffs SET consumed_at = ? WHERE handoff_hash = ? AND consumed_at IS NULL AND expires_at > ? RETURNING google_subject")
    .bind(now, hash, now)
    .first();
  return row?.google_subject ?? null;
}

export async function createSession(database, { token, subject, now }) {
  const hash = await sha256(token);
  const expiresAt = new Date(new Date(now).getTime() + DEVICE_SESSION_LIFETIME_MS).toISOString();
  await database
    .prepare("INSERT INTO oauth_sessions (session_hash, google_subject, expires_at, revoked_at, created_at) VALUES (?, ?, ?, NULL, ?)")
    .bind(hash, subject, expiresAt, now)
    .run();
  return { expiresAt };
}

export async function rotateSession(database, { token, nextToken, now }) {
  const hash = await sha256(token);
  const nextHash = await sha256(nextToken);
  const expiresAt = new Date(new Date(now).getTime() + DEVICE_SESSION_LIFETIME_MS).toISOString();
  const statements = [
    database.prepare(`INSERT INTO oauth_sessions (session_hash, google_subject, expires_at, revoked_at, created_at)
      SELECT ?, google_subject, ?, NULL, created_at FROM oauth_sessions
      WHERE session_hash = ? AND expires_at > ? AND revoked_at IS NULL`).bind(nextHash, expiresAt, hash, now),
    database.prepare("UPDATE oauth_sessions SET revoked_at = ? WHERE session_hash = ? AND revoked_at IS NULL").bind(now, hash)
  ];
  const results = await database.batch(statements);
  if (!Array.isArray(results) || results.length !== statements.length || results.some((result) => result?.success === false)) {
    throw new Error("session-rotation-failed");
  }
  if (results[0]?.meta?.changes === 0) return null;
  return { expiresAt };
}

export async function sessionAccount(database, { token, now }) {
  const hash = await sha256(token);
  return database
    .prepare(`SELECT a.google_subject, a.token_ciphertext, a.token_iv, a.scopes, a.token_expires_at, s.created_at AS session_created_at
      FROM oauth_sessions s JOIN oauth_accounts a ON a.google_subject = s.google_subject
      WHERE s.session_hash = ? AND s.expires_at > ? AND s.revoked_at IS NULL AND a.revoked_at IS NULL`)
    .bind(hash, now)
    .first();
}

export async function deleteAccountData(database, { subject }) {
  const statements = [
    database.prepare("DELETE FROM recovery_requests WHERE google_subject = ?").bind(subject),
    database.prepare("DELETE FROM oauth_handoffs WHERE google_subject = ?").bind(subject),
    database.prepare("DELETE FROM oauth_sessions WHERE google_subject = ?").bind(subject),
    database.prepare("DELETE FROM oauth_accounts WHERE google_subject = ?").bind(subject)
  ];
  const results = await database.batch(statements);
  if (!Array.isArray(results) || results.length !== statements.length || results.some((result) => result?.success === false)) {
    throw new Error("account-deletion-incomplete");
  }
  return { deleted: true };
}

export async function revokeSession(database, { token, now }) {
  const hash = await sha256(token);
  const row = await database
    .prepare("UPDATE oauth_sessions SET revoked_at = ? WHERE session_hash = ? AND revoked_at IS NULL RETURNING google_subject")
    .bind(now, hash)
    .first();
  return Boolean(row?.google_subject);
}

async function sha256(value) { const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))); return btoa(String.fromCharCode(...bytes)); }

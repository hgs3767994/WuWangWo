export async function saveAccount(database, { subject, envelope, scopes, expiresAt, refreshTokenPresent, now }) {
  await database.prepare(`INSERT INTO oauth_accounts (google_subject, token_ciphertext, token_iv, scopes, token_expires_at, refresh_token_present, created_at, updated_at, revoked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(google_subject) DO UPDATE SET token_ciphertext = excluded.token_ciphertext, token_iv = excluded.token_iv, scopes = excluded.scopes, token_expires_at = excluded.token_expires_at, refresh_token_present = excluded.refresh_token_present, updated_at = excluded.updated_at, revoked_at = NULL`)
    .bind(subject, envelope.ciphertext, envelope.iv, scopes, expiresAt, refreshTokenPresent ? 1 : 0, now, now).run();
}

-- Run once in the Cloudflare D1 Console after 0004-recovery-v3.sql.
-- Renewal credentials can only mint one-hour access sessions; they are never
-- accepted by Drive, recovery, or account-deletion endpoints.
CREATE TABLE IF NOT EXISTS oauth_session_renewals (
  renewal_hash TEXT PRIMARY KEY,
  google_subject TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (google_subject) REFERENCES oauth_accounts(google_subject)
);

CREATE INDEX IF NOT EXISTS idx_oauth_session_renewals_expiry ON oauth_session_renewals(expires_at);

-- v177 briefly issued direct Drive sessions for 30 days. Limit every existing
-- direct session to at most one hour from this migration so that old clients
-- cannot retain the longer authorization window.
UPDATE oauth_sessions
SET expires_at = MIN(expires_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 hour'))
WHERE revoked_at IS NULL;

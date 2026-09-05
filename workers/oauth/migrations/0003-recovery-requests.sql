-- Run once in the Cloudflare D1 Console after 0002-sessions.sql.
-- This table is deliberately opaque: it must never contain a recovery code,
-- master password, DEK, vault plaintext, or any wrapper around the DEK.
CREATE TABLE IF NOT EXISTS recovery_requests (
  request_id TEXT PRIMARY KEY,
  google_subject TEXT NOT NULL,
  vault_id TEXT NOT NULL,
  requester_device_id TEXT NOT NULL,
  pairing_code TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  expires_at TEXT NOT NULL,
  approved_at TEXT,
  approved_by_device_id TEXT,
  approved_session_epoch INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (google_subject) REFERENCES oauth_accounts(google_subject)
);

CREATE INDEX IF NOT EXISTS idx_recovery_requests_subject_status ON recovery_requests(google_subject, status, expires_at);

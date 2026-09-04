-- Run once in Cloudflare D1 Console after the initial schema.sql import.
-- This migration introduces short-lived opaque sessions for the browser/native client.
CREATE TABLE IF NOT EXISTS oauth_sessions (
  session_hash TEXT PRIMARY KEY,
  google_subject TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (google_subject) REFERENCES oauth_accounts(google_subject)
);

CREATE INDEX IF NOT EXISTS idx_oauth_sessions_expiry ON oauth_sessions(expires_at);

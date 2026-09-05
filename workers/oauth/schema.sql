CREATE TABLE IF NOT EXISTS oauth_accounts (
  google_subject TEXT PRIMARY KEY,
  token_ciphertext TEXT NOT NULL,
  token_iv TEXT NOT NULL,
  scopes TEXT NOT NULL,
  token_expires_at TEXT,
  refresh_token_present INTEGER NOT NULL CHECK (refresh_token_present IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS oauth_handoffs (
  handoff_hash TEXT PRIMARY KEY,
  google_subject TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (google_subject) REFERENCES oauth_accounts(google_subject)
);

CREATE INDEX IF NOT EXISTS idx_oauth_handoffs_expiry ON oauth_handoffs(expires_at);

CREATE TABLE IF NOT EXISTS oauth_sessions (
  session_hash TEXT PRIMARY KEY,
  google_subject TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (google_subject) REFERENCES oauth_accounts(google_subject)
);

CREATE INDEX IF NOT EXISTS idx_oauth_sessions_expiry ON oauth_sessions(expires_at);

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

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

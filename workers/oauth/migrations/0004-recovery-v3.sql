-- Recovery v3 uses an ephemeral requester public key and a sealed DEK transfer.
-- Existing v2 requests cannot be resumed safely, so migration expires them.
DROP INDEX IF EXISTS idx_recovery_requests_subject_status;
ALTER TABLE recovery_requests RENAME TO recovery_requests_v2;

CREATE TABLE recovery_requests (
  request_id TEXT PRIMARY KEY,
  google_subject TEXT NOT NULL,
  vault_id TEXT NOT NULL,
  requester_device_id TEXT NOT NULL,
  requester_public_key TEXT NOT NULL,
  pairing_code TEXT NOT NULL,
  base_session_epoch INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'transfer_ready', 'completed', 'cancelled', 'expired')),
  expires_at TEXT NOT NULL,
  verification_code_hash TEXT,
  verification_code_salt TEXT,
  verification_attempts INTEGER NOT NULL DEFAULT 0,
  transfer_envelope TEXT,
  approved_at TEXT,
  approved_by_device_id TEXT,
  approved_session_epoch INTEGER,
  completed_at TEXT,
  completed_session_epoch INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (google_subject) REFERENCES oauth_accounts(google_subject)
);

DROP TABLE recovery_requests_v2;

CREATE INDEX idx_recovery_requests_subject_status ON recovery_requests(google_subject, status, expires_at);
CREATE INDEX idx_recovery_requests_vault_status ON recovery_requests(google_subject, vault_id, status);

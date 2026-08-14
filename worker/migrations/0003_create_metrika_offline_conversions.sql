CREATE TABLE IF NOT EXISTS metrika_offline_conversions (
  submission_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  conversion_at INTEGER NOT NULL,
  target TEXT NOT NULL,
  client_id TEXT,
  yclid TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'sent', 'expired')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_attempt_at TEXT,
  sent_at TEXT,
  upload_id INTEGER,
  error_code TEXT
);

CREATE INDEX IF NOT EXISTS idx_metrika_offline_due
  ON metrika_offline_conversions(status, next_attempt_at);

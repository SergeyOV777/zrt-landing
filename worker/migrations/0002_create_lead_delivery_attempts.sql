CREATE TABLE IF NOT EXISTS lead_delivery_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  attempted_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('processing', 'sent', 'failed')),
  error_code TEXT,
  amo_lead_id INTEGER,
  UNIQUE (submission_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS idx_lead_delivery_attempts_submission
  ON lead_delivery_attempts(submission_id, id);

CREATE INDEX IF NOT EXISTS idx_lead_delivery_attempts_status
  ON lead_delivery_attempts(status, id);

INSERT OR IGNORE INTO lead_delivery_attempts (
  submission_id,
  attempt_number,
  attempted_at,
  finished_at,
  status,
  error_code,
  amo_lead_id
)
SELECT
  submission_id,
  attempts,
  received_at,
  CASE WHEN status = 'processing' THEN NULL ELSE updated_at END,
  status,
  error_code,
  amo_lead_id
FROM lead_submissions;

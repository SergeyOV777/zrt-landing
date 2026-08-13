CREATE TABLE IF NOT EXISTS lead_submissions (
  submission_id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  source TEXT NOT NULL,
  page_path TEXT NOT NULL,
  scenario TEXT NOT NULL,
  contact_method TEXT NOT NULL,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  status TEXT NOT NULL CHECK (status IN ('processing', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 1,
  amo_lead_id INTEGER,
  amo_contact_id INTEGER,
  amo_merged INTEGER,
  error_code TEXT
);

CREATE INDEX IF NOT EXISTS idx_lead_submissions_received_at
  ON lead_submissions(received_at);

CREATE INDEX IF NOT EXISTS idx_lead_submissions_status
  ON lead_submissions(status);

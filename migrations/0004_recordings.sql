-- 0004_recordings.sql — Foundry Clarion org settings + recording metadata.
-- Recording is OFF by default (Steven, 2026-07-16): the default is DDL, not app logic.
PRAGMA foreign_keys = ON;

CREATE TABLE cc_org_settings (
  organization_id   TEXT PRIMARY KEY,
  recording_enabled INTEGER NOT NULL DEFAULT 0,
  announcement_text TEXT,
  updated_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE cc_recordings (
  id                   TEXT PRIMARY KEY,
  organization_id      TEXT NOT NULL,
  call_id              TEXT NOT NULL REFERENCES cc_calls(id) ON DELETE CASCADE,
  twilio_recording_sid TEXT NOT NULL,
  r2_key               TEXT NOT NULL,
  duration_s           INTEGER,
  transcript_r2_key    TEXT,
  transcript_status    TEXT NOT NULL DEFAULT 'pending',
  created_at           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, twilio_recording_sid)
);
CREATE INDEX idx_cc_recordings_org  ON cc_recordings(organization_id);
CREATE INDEX idx_cc_recordings_call ON cc_recordings(call_id);

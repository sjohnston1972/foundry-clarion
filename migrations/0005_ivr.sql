-- 0005_ivr.sql — Foundry Clarion IVR builder: flows + voicemails.
-- Engine = Clarion-native TwiML interpreter, not Twilio Studio (2026-07-17, Steven).
PRAGMA foreign_keys = ON;

CREATE TABLE cc_ivr_flows (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL,
  name             TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'draft',
  definition_json  TEXT NOT NULL,
  updated_at       INTEGER NOT NULL
);
CREATE INDEX idx_cc_ivr_flows_org ON cc_ivr_flows(organization_id);

CREATE TABLE cc_voicemails (
  id                   TEXT PRIMARY KEY,
  organization_id      TEXT NOT NULL,
  flow_id              TEXT REFERENCES cc_ivr_flows(id) ON DELETE SET NULL,
  twilio_call_sid      TEXT NOT NULL,
  from_e164            TEXT,
  r2_key               TEXT NOT NULL,
  duration_s           INTEGER,
  transcript_r2_key    TEXT,
  transcript_status    TEXT DEFAULT 'pending',
  created_at           INTEGER NOT NULL
);
CREATE INDEX idx_cc_voicemails_org  ON cc_voicemails(organization_id);
CREATE INDEX idx_cc_voicemails_flow ON cc_voicemails(flow_id);

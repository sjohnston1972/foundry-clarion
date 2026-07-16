-- 0003_queues_calls.sql — Foundry Clarion queues, queue membership, and the call log.
-- organization_id is an AuthPak id (TEXT). No cross-database FKs. Phase 3, dry-run only.
PRAGMA foreign_keys = ON;

-- A queue = a TaskRouter Workflow. DRY_RUN yields a deterministic 'WWdryrun...' SID.
CREATE TABLE cc_queues (
  id                  TEXT PRIMARY KEY,
  organization_id     TEXT NOT NULL,
  name                TEXT NOT NULL,
  twilio_workflow_sid TEXT,                     -- WW...; NULL until provisioned
  strategy            TEXT NOT NULL DEFAULT 'longest-idle',
  created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, name)
);
CREATE INDEX idx_cc_queues_org ON cc_queues(organization_id);

-- Which agents serve which queues, and at what priority.
CREATE TABLE cc_queue_members (
  queue_id  TEXT NOT NULL REFERENCES cc_queues(id) ON DELETE CASCADE,
  agent_id  TEXT NOT NULL REFERENCES cc_agents(id) ON DELETE CASCADE,
  priority  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (queue_id, agent_id)
);
CREATE INDEX idx_cc_queue_members_agent ON cc_queue_members(agent_id);

-- Call log (reporting). queue_id/agent_id are nullable — a call may never route or connect.
CREATE TABLE cc_calls (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  twilio_call_sid TEXT NOT NULL,
  from_e164       TEXT NOT NULL,
  to_e164         TEXT NOT NULL,
  queue_id        TEXT REFERENCES cc_queues(id) ON DELETE SET NULL,
  agent_id        TEXT REFERENCES cc_agents(id) ON DELETE SET NULL,
  disposition     TEXT,
  duration_s      INTEGER,
  started_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, twilio_call_sid)
);
CREATE INDEX idx_cc_calls_org ON cc_calls(organization_id);
CREATE INDEX idx_cc_calls_queue ON cc_calls(queue_id);
CREATE INDEX idx_cc_calls_agent ON cc_calls(agent_id);

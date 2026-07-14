-- 0002_agents.sql — Foundry Clarion agents, skill catalog, and the routing snapshot.
-- organization_id / user_id are AuthPak ids (TEXT). Workspace linkage is by EMAIL (no cross-DB FK).
-- All Clarion ids are app-generated UUIDs (TEXT).
PRAGMA foreign_keys = ON;

-- A member enabled as a live agent. Linked to a Workspace resource by email (snapshot).
CREATE TABLE cc_agents (
  id                    TEXT PRIMARY KEY,
  organization_id       TEXT NOT NULL,
  user_id               TEXT,                     -- AuthPak sub, if the agent is also a Clarion member; may be NULL
  email                 TEXT NOT NULL,
  workspace_resource_id TEXT,                     -- resources.id from WORKSPACE_DB (matched by lower(email))
  twilio_worker_sid     TEXT,                     -- WK...; DRY_RUN yields 'WKdryrun...'; NULL until provisioned
  status                TEXT NOT NULL DEFAULT 'offline'
                          CHECK (status IN ('offline','available','on-call','wrap-up')),
  activity_sid          TEXT,
  enabled_at            TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, email)
);
CREATE INDEX idx_cc_agents_org ON cc_agents(organization_id);

-- Clarion's own per-org skill catalog (names snapshotted from Workspace at enable-time).
CREATE TABLE cc_skills (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name            TEXT NOT NULL,
  UNIQUE (organization_id, name)
);
CREATE INDEX idx_cc_skills_org ON cc_skills(organization_id);

-- The routing snapshot: which agent has which skill, at what proficiency.
CREATE TABLE cc_agent_skills (
  agent_id    TEXT NOT NULL REFERENCES cc_agents(id) ON DELETE CASCADE,
  skill_id    TEXT NOT NULL REFERENCES cc_skills(id) ON DELETE CASCADE,
  proficiency INTEGER,                            -- Workspace level 0..5, snapshotted
  synced_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (agent_id, skill_id)
);

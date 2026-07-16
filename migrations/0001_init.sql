-- 0001_init.sql — Foundry Clarion base tables.
-- organization_id / user_id are AuthPak ids (TEXT). No cross-database FKs.
PRAGMA foreign_keys = ON;

-- Tenant directory, accreted from JWT claims (mirrors Workspace's org_directory).
CREATE TABLE cc_org_directory (
  organization_id TEXT PRIMARY KEY,
  name        TEXT,
  slug        TEXT,
  owner_email TEXT,
  disabled    INTEGER NOT NULL DEFAULT 0,
  first_seen  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Clarion's own per-user roles (AuthPak's JWT does NOT carry these).
CREATE TABLE cc_members (
  organization_id TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  clarion_role    TEXT NOT NULL CHECK (clarion_role IN ('admin','supervisor','agent')),
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, user_id)
);
CREATE INDEX idx_cc_members_org ON cc_members(organization_id);

-- Who changed what.
CREATE TABLE cc_audit_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id TEXT,
  user_id         TEXT,
  action          TEXT NOT NULL,
  meta_json       TEXT,
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_cc_audit_org ON cc_audit_log(organization_id);

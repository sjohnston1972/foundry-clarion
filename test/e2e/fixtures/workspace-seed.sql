-- Local-dev-only fixture for the local WORKSPACE_DB emulation (skills-foundry-db).
-- Applied via `wrangler d1 execute skills-foundry-db --local --file=...` — never touches
-- the real skills-foundry-db or the sibling repo. Minimal shape server/db/workspace.ts
-- queries (departments/resources), just enough for Step 11's Playwright "enable a
-- candidate" flow to have a real candidate to enable for org-step11.
CREATE TABLE IF NOT EXISTS departments (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS resources (id TEXT PRIMARY KEY, name TEXT, email TEXT, job_role TEXT, department_id TEXT);
CREATE TABLE IF NOT EXISTS sub_skills (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE IF NOT EXISTS resource_sub_skills (resource_id TEXT, sub_skill_id INTEGER, level INTEGER);

DELETE FROM resources WHERE id = 'step11-res-1';
DELETE FROM departments WHERE id = 'step11-dept-1';
DELETE FROM resources WHERE id = 'step12-res-1';
DELETE FROM departments WHERE id = 'step12-dept-1';

INSERT INTO departments (id, organization_id) VALUES ('step11-dept-1', 'org-step11');
INSERT INTO resources (id, name, email, job_role, department_id)
  VALUES ('step11-res-1', 'Ada Candidate', 'ada.candidate@example.com', 'Support', 'step11-dept-1');

-- Step 12: an enable-able resource for org-step12 so the Queues page has an agent to assign.
INSERT INTO departments (id, organization_id) VALUES ('step12-dept-1', 'org-step12');
INSERT INTO resources (id, name, email, job_role, department_id)
  VALUES ('step12-res-1', 'Bea Candidate', 'bea.candidate@example.com', 'Support', 'step12-dept-1');

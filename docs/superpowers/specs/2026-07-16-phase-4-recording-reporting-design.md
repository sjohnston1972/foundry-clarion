# Phase 4 — Recording, transcripts, and reporting (design)

**Date:** 2026-07-16
**Status:** approved (Steven, this session)
**Phase:** 4 of the roadmap in `docs/design/foundry-clarion-design.md` §9
**Gate cleared:** the recording-consent product decision, which §9 named as the blocker on
this phase, is settled in §1 below.

---

## 1. The consent decision (the gate)

`docs/design/foundry-clarion-design.md` §9 gates Phase 4 on a product/legal decision Steven
owns. **Decided 2026-07-16:**

> **Recording is off by default. When an org enables it, an announcement plays to the caller
> and cannot be disabled separately.**

Consequences that the code must express, not merely document:

- `cc_org_settings.recording_enabled` is `INTEGER NOT NULL DEFAULT 0`. The default posture is
  DDL, not application logic — a misconfigured or half-provisioned org records nothing.
- There is **no independent announcement toggle**. Announcement is a function of
  `recording_enabled`, so the two cannot drift apart into "recording silently".
- The announcement *wording* is per-org (`cc_org_settings.announcement_text`, nullable, code
  falls back to a default). Jurisdictions differ on required wording in a way they do not
  differ on "must announce"; the toggle is a rule, the wording is a setting.

This decision is pinned by an executable test (§7, "the consent invariant"). Prose rots;
assertions do not.

---

## 2. Scope

Three arcs, all dry-run, all local. Nothing in this phase mutates Twilio or Cloudflare
account state.

- **Arc A — Capture:** org settings, `cc_recordings`, announcement TwiML, recording start,
  `recordingStatusCallback` → R2.
- **Arc B — Transcripts:** Workers AI Whisper over the R2 object, behind a dry-run flag.
- **Arc C — Reporting:** filtered/aggregated call reporting API + UI, recording playback,
  transcript viewing, and the admin settings toggle.

**Explicitly out of scope** (named so a future session does not treat the omission as an
oversight):

- `cc_numbers` / dialed-number lookup. Voice webhooks keep resolving org and queue via
  `?orgId=&queueId=`. This is known debt, deliberately deferred — it touches Phase 3's
  webhook contract and belongs in its own run.
- Conference-based recording (see §4). Requires reservation acceptance, which is Phase 5.
- Retention policies, redaction/PII scrubbing, and transcript search. YAGNI until asked.
- Any live Twilio or Workers AI call.

---

## 3. Data model — migration `0004_recordings.sql`

```sql
CREATE TABLE cc_org_settings (
  organization_id   TEXT PRIMARY KEY,
  recording_enabled INTEGER NOT NULL DEFAULT 0,   -- §1: the consent default, as DDL
  announcement_text TEXT,                          -- NULL => code default
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
  transcript_status    TEXT NOT NULL DEFAULT 'pending',  -- pending|done|failed|skipped
  created_at           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, twilio_recording_sid)
);
CREATE INDEX idx_cc_recordings_org  ON cc_recordings(organization_id);
CREATE INDEX idx_cc_recordings_call ON cc_recordings(call_id);
```

**Deliberate deviation from the design doc.** `docs/design/foundry-clarion-design.md` §4
sketches `cc_recordings` without `organization_id`, reaching org through `call_id`. This spec
adds the column, because CLAUDE.md §6 requires every row to be scoped by `org_id`, and
because it turns the cross-tenant leak test into a direct assertion rather than one that
depends on a join being written correctly at every call site. Update the design doc's §4 row
when this lands.

`transcript_status` is the seam that keeps §5's simplicity honest: it makes a failed
transcript visible and lets a Queues consumer or retry endpoint be added later with no
schema change.

**R2 key layout** (org-prefixed for defense-in-depth and future per-org lifecycle rules):

```
orgs/{orgId}/calls/{callSid}/{recordingSid}.mp3
orgs/{orgId}/calls/{callSid}/{recordingSid}.transcript.json
```

---

## 4. Arc A — Capture

**Announcement.** `POST /api/voice/inbound` reads `cc_org_settings`. When
`recording_enabled = 1` it prepends `<Say>{announcement_text ?? DEFAULT}</Say>` to the
existing `<Enqueue>`. When `0`, the TwiML is byte-for-byte what Phase 3 produces today.

**Starting the recording — and the option rejected.** `<Enqueue>` has no `record`
attribute, so recording cannot start at enqueue time. The textbook TaskRouter approach
records the *conference* the agent joins on reservation accept — but Phase 3 never built
reservation acceptance, so taking that path means building Phase 5 to finish Phase 4.

Instead, `POST /api/voice/status` starts recording on the in-progress call leg via the REST
API (`POST /2010-04-01/Accounts/{AccountSid}/Calls/{CallSid}/Recordings.json`, passing
`RecordingStatusCallback`) when `CallStatus` is `in-progress` and recording is enabled. This
is a documented call against a live leg and depends on nothing that does not yet exist.
**Phase 5 should migrate to conference recording once reservations land** — at that point
this call becomes redundant, not merely legacy.

**`POST /api/voice/recording`** (new) handles `recordingStatusCallback`:

1. Validate `X-Twilio-Signature` (reuse `server/lib/twilio/signature.ts`). Invalid ⇒ 403.
2. Mounted **outside** the AuthPak gate, alongside the other voice webhooks — trust is the
   signature, never the `fnd_session` cookie.
3. On `RecordingStatus = completed`: fetch the media, `RECORDINGS.put(key, bytes)`, insert
   the `cc_recordings` row, then `ctx.waitUntil(transcribe(...))`.
4. Return 204 immediately. Twilio must never wait on Whisper.

Under `TWILIO_DRY_RUN`, both the recording-start REST call and the media fetch are
short-circuited: a deterministic `REdryrun_*` SID and synthesized bytes, no network. The R2
write is **real** even in dry-run (Miniflare simulates R2 locally), so capture is genuinely
exercised rather than mocked away.

---

## 5. Arc B — Transcripts

`server/lib/ai/transcribe.ts`, mirroring the existing dry-run shape of
`server/lib/twilio/provisioning.ts` rather than inventing a second pattern.

- Reads the object back from R2, calls `env.AI.run('@cf/openai/whisper', { audio: [...] })`,
  writes the result to R2 as JSON, sets `transcript_r2_key` and `transcript_status = 'done'`.
- Runs in `ctx.waitUntil`, not inline. `AI.run` is network-bound, not CPU-bound, so it does
  not threaten the Workers CPU limit.
- **Failure sets `transcript_status = 'failed'` and never throws.** A lost transcript must
  not lose the recording.

**`AI_DRY_RUN` defaults to `"true"`, and this is a cost rail, not a convenience.** Workers AI
has no local simulator: under `wrangler dev` the `AI` binding proxies to the *real* API and
bills the account. Without this flag an autonomous overnight run would quietly spend money —
precisely what CLAUDE.md §12 exists to prevent. It stays `"true"` for the entire run, and a
test asserts that no network call escapes when it is set.

---

## 6. Arc C — Reporting

**API** (`server/routes/reports.ts`, `server/db/recordings.ts`):

| Endpoint | Purpose | Role |
|---|---|---|
| `GET /api/reports/calls` | Rows + aggregates; filters `from`, `to`, `queueId`, `agentId`, `disposition` | supervisor / admin |
| `GET /api/recordings/:id/media` | Streams audio from R2 | supervisor / admin |
| `GET /api/recordings/:id/transcript` | Transcript JSON | supervisor / admin |
| `GET  /api/settings` · `PATCH /api/settings` | Recording toggle + announcement text | admin |

Aggregates: total calls, answered, abandoned, average duration. Every query is org-scoped
through the existing accessor layer — no raw SQL in handlers (CLAUDE.md §10). Reporting and
playback are **supervisor/admin only**: an agent has no business reading the org's whole call
history, and recorded audio is the most sensitive data Clarion holds.

**UI**, on the vendored design system (CLAUDE.md §14), no new primitives:

- `src/pages/Reports.tsx` — `Stat` tiles for the aggregates, a filterable table, an audio
  player, and a transcript panel keyed off `transcript_status` (pending/failed render
  distinctly rather than as an empty box).
- `src/pages/Settings.tsx` — admin-only; the recording toggle and announcement text. The
  toggle's UI copy must state that enabling recording also enables the announcement, since
  §1 makes that a property of the system rather than a second choice.

---

## 7. Bindings and configuration

`wrangler.jsonc` gains:

```jsonc
"r2_buckets": [ { "binding": "RECORDINGS", "bucket_name": "foundry-clarion-recordings" } ],
"ai": { "binding": "AI" },
"vars": { "AUTH_ENFORCE": "false", "TWILIO_DRY_RUN": "true", "AI_DRY_RUN": "true" }
```

No `database_id` values are filled in; this run stays local. The R2 bucket is **not** created
in the cloud during this run — Miniflare provides it locally.

---

## 8. Testing

Mirrors the established shape (`test/*.test.ts` + `test/e2e`):

- **Migration:** `0004` applies; defaults are as specified (notably `recording_enabled = 0`).
- **Accessors:** `recordings-db.test.ts`, including an explicit **cross-tenant leak test** —
  org B cannot read org A's recordings by id.
- **Routes:** signature rejection (403) on `/api/voice/recording`; role gates on every
  reporting endpoint (agent ⇒ 403); org scoping on media/transcript fetch.
- **Dry-run rails:** no network escapes with `TWILIO_DRY_RUN=true`; no `AI.run` call escapes
  with `AI_DRY_RUN=true`. Asserted, in the manner Phase 3 asserted `WWdryrun_*`.
- **Transcription:** dry-run returns a stub; a thrown provider error ⇒ `transcript_status =
  'failed'` and the recording row survives intact.
- **The consent invariant** (the §1 gate, as an assertion): with `recording_enabled = 0` the
  inbound TwiML contains no `<Say>` **and** no recording is started; flipped to `1`, the
  announcement appears. This test is the durable form of the legal decision.
- **Playwright:** Settings toggle on → seeded call appears on Reports with its recording →
  audio element present → transcript renders. Screenshot into the run archive per step.

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| Workers AI billing during a local run | `AI_DRY_RUN=true` default + an asserting test (§5) |
| Recording without consent | Announcement is not independently disableable (§1) + consent invariant test (§8) |
| Whisper failure loses the recording | `transcript_status='failed'`, never throw (§5) |
| Recording-start approach is superseded in Phase 5 | Documented as expected (§4); the REST call becomes redundant, not legacy debt |
| `@cloudflare/vitest-pool-workers` still broken on Windows | Unchanged from the last run; live Playwright proofs stand in. Not a Phase 4 regression. |

---

## 10. Decisions locked this session (2026-07-16)

- Recording **off by default**, announcement **forced** when enabled; wording per-org.
- Transcripts via **Cloudflare Workers AI (Whisper)** — keeps call audio inside the
  Cloudflare account, no new vendor, no new secret.
- Transcription triggered **inline via `ctx.waitUntil`** with a `transcript_status` seam;
  Cloudflare Queues deferred until durability is actually needed.
- Scope is **three arcs, dry-run**; `cc_numbers` explicitly deferred.
- Phase 4 branches from **`main` after PR #1 merges** (CLAUDE.md §4 forbids pushing `main`
  directly, so the merge is Steven's).

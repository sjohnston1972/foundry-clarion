import type { Bindings } from '../../types'

const TASKROUTER_BASE = 'https://taskrouter.twilio.com/v1'
const API_BASE = 'https://api.twilio.com/2010-04-01'

export function isDryRun(env: Bindings): boolean {
  return env.TWILIO_DRY_RUN !== 'false'
}

function authHeader(env: Bindings): string {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
    throw new Error('Missing Twilio credentials (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)')
  }
  return 'Basic ' + btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)
}

/** Create a TaskRouter Worker for an agent. DRY_RUN => deterministic fake SID, no network. */
export async function createWorker(
  env: Bindings,
  args: { orgId: string; friendlyName: string; attributes: Record<string, unknown> },
): Promise<{ workerSid: string; dryRun: boolean }> {
  if (isDryRun(env)) {
    return { workerSid: `WKdryrun_${crypto.randomUUID().replace(/-/g, '')}`, dryRun: true }
  }
  // LIVE PATH — only reached after Steven flips TWILIO_DRY_RUN=false in-session.
  // Check credentials first (will throw if missing)
  const auth = authHeader(env)
  const workspaceSid = env.TWILIO_TASKROUTER_WORKSPACE_SID
  if (!workspaceSid) throw new Error('Missing TWILIO_TASKROUTER_WORKSPACE_SID for live worker creation')
  const body = new URLSearchParams({
    FriendlyName: args.friendlyName,
    Attributes: JSON.stringify({ ...args.attributes, organization_id: args.orgId }),
  })
  const res = await fetch(`${TASKROUTER_BASE}/Workspaces/${workspaceSid}/Workers`, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(`TaskRouter createWorker failed: ${res.status} ${await res.text()}`)
  const json = (await res.json()) as { sid: string }
  return { workerSid: json.sid, dryRun: false }
}

/** Create a TaskRouter Workflow for a queue. DRY_RUN => deterministic fake SID, no network. */
export async function createWorkflow(
  env: Bindings,
  args: { orgId: string; friendlyName: string; configuration: Record<string, unknown> },
): Promise<{ workflowSid: string; dryRun: boolean }> {
  if (isDryRun(env)) {
    return { workflowSid: `WWdryrun_${crypto.randomUUID().replace(/-/g, '')}`, dryRun: true }
  }
  // LIVE PATH — only reached after Steven flips TWILIO_DRY_RUN=false in-session.
  const auth = authHeader(env)
  const workspaceSid = env.TWILIO_TASKROUTER_WORKSPACE_SID
  if (!workspaceSid) throw new Error('Missing TWILIO_TASKROUTER_WORKSPACE_SID for live workflow creation')
  const body = new URLSearchParams({
    FriendlyName: args.friendlyName,
    Configuration: JSON.stringify({ ...args.configuration, organization_id: args.orgId }),
  })
  const res = await fetch(`${TASKROUTER_BASE}/Workspaces/${workspaceSid}/Workflows`, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(`TaskRouter createWorkflow failed: ${res.status} ${await res.text()}`)
  const json = (await res.json()) as { sid: string }
  return { workflowSid: json.sid, dryRun: false }
}

/** Start recording an in-progress call leg. DRY_RUN => deterministic fake SID, no network. */
export async function startCallRecording(
  env: Bindings, args: { callSid: string; recordingStatusCallback: string },
): Promise<{ recordingSid: string; dryRun: boolean }> {
  if (isDryRun(env)) {
    return { recordingSid: `REdryrun_${crypto.randomUUID().replace(/-/g, '')}`, dryRun: true }
  }
  // LIVE PATH — only reached after Steven flips TWILIO_DRY_RUN=false in-session.
  const auth = authHeader(env)
  const body = new URLSearchParams({
    RecordingStatusCallback: args.recordingStatusCallback,
    RecordingStatusCallbackEvent: 'completed',
  })
  const res = await fetch(`${API_BASE}/Accounts/${env.TWILIO_ACCOUNT_SID}/Calls/${args.callSid}/Recordings.json`, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(`Twilio startCallRecording failed: ${res.status} ${await res.text()}`)
  const json = (await res.json()) as { sid: string }
  return { recordingSid: json.sid, dryRun: false }
}

/** Ensure the single shared TaskRouter Workspace exists. DRY_RUN => returns configured/fake sid. */
export async function ensureTaskRouterWorkspace(env: Bindings): Promise<{ workspaceSid: string; dryRun: boolean }> {
  if (isDryRun(env)) {
    return { workspaceSid: env.TWILIO_TASKROUTER_WORKSPACE_SID ?? 'WSdryrun_shared', dryRun: true }
  }
  if (env.TWILIO_TASKROUTER_WORKSPACE_SID) return { workspaceSid: env.TWILIO_TASKROUTER_WORKSPACE_SID, dryRun: false }
  // LIVE creation is an account mutation — requires Steven's explicit go (Preconditions).
  const body = new URLSearchParams({ FriendlyName: 'Foundry Clarion (shared)', EventCallbackUrl: '' })
  const res = await fetch(`${TASKROUTER_BASE}/Workspaces`, {
    method: 'POST',
    headers: { Authorization: authHeader(env), 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(`TaskRouter createWorkspace failed: ${res.status} ${await res.text()}`)
  const json = (await res.json()) as { sid: string }
  return { workspaceSid: json.sid, dryRun: false }
}

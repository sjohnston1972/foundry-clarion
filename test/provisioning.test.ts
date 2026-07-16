import { describe, it, expect } from 'vitest'
import { isDryRun, createWorker } from '../server/lib/twilio/provisioning'

const baseEnv = {
  TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't',
  TWILIO_TASKROUTER_WORKSPACE_SID: 'WS1',
} as unknown as import('../server/types').Bindings

describe('provisioning DRY_RUN', () => {
  it('defaults to dry when the flag is unset', () => {
    expect(isDryRun({ ...baseEnv })).toBe(true)
  })
  it('createWorker returns a fake WK sid without hitting the network', async () => {
    const out = await createWorker({ ...baseEnv, TWILIO_DRY_RUN: 'true' }, { orgId: 'o1', friendlyName: 'ada@x.com', attributes: { organization_id: 'o1' } })
    expect(out.dryRun).toBe(true)
    expect(out.workerSid.startsWith('WKdryrun_')).toBe(true)
  })
  it('honours an explicit false flag (would go live) but errors without creds instead of silently faking', async () => {
    await expect(
      createWorker({ TWILIO_DRY_RUN: 'false' } as never, { orgId: 'o1', friendlyName: 'x', attributes: {} }),
    ).rejects.toThrow(/twilio credentials/i)
  })
})

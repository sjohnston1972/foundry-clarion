import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { computeTwilioSignature } from '../../server/lib/twilio/signature'

// Step 12 (Phase 4): seeds a call + recording through the REAL API surface — the
// signed Twilio webhooks, no direct DB writes — then drives /reports as a
// supervisor-capable session: Stat tiles match the API's own summary, the seeded
// call row opens, an <audio> element sources /api/recordings/:id/media, and the
// dry-run transcript text renders. Unique SIDs per run keep reruns valid (data
// accumulates in org-p4-step12; tiles are asserted against the live API summary).
const ORG = 'org-p4-step12'
const WORKER = 'http://localhost:8787'

function authToken(): string {
  const m = /^TWILIO_AUTH_TOKEN=(.+)$/m.exec(readFileSync(path.resolve(import.meta.dirname, '../../.dev.vars'), 'utf8'))
  if (!m) throw new Error('TWILIO_AUTH_TOKEN not found in .dev.vars')
  return m[1].trim()
}

test('reports page shows summary tiles, plays the recording, renders the transcript', async ({ page, context }) => {
  const sess = await context.request.post('/api/dev/session', {
    data: { email: 'admin@example.com', orgId: ORG, role: 'owner' },
  })
  expect(sess.status()).toBe(200)

  // Seed: signed status webhook writes the cc_calls row; signed recording webhook
  // writes R2 + cc_recordings and hands off dry-run transcription via waitUntil.
  // Signatures are computed over the exact worker-origin URL (no Vite proxy hop).
  const token = authToken()
  const stamp = Date.now()
  const callSid = `CAe2e_${stamp}`
  const recordingSid = `REe2e_${stamp}`

  const twilioPost = async (pathAndQuery: string, params: Record<string, string>) => {
    const url = `${WORKER}${pathAndQuery}`
    const signature = await computeTwilioSignature(token, url, params)
    return context.request.post(url, {
      headers: { 'X-Twilio-Signature': signature, 'content-type': 'application/x-www-form-urlencoded' },
      form: params,
    })
  }

  const status = await twilioPost(`/api/voice/status?orgId=${ORG}`, {
    CallSid: callSid, From: '+15550001111', To: '+15550002222', CallStatus: 'completed', CallDuration: '42',
  })
  expect(status.status()).toBe(204)

  const recording = await twilioPost(`/api/voice/recording?orgId=${ORG}`, {
    CallSid: callSid, RecordingSid: recordingSid, RecordingStatus: 'completed',
    RecordingDuration: '42', RecordingUrl: 'https://api.twilio.com/unused-in-dry-run',
  })
  expect(recording.status()).toBe(204)

  // The tiles must equal what the API itself reports for this org right now —
  // robust to data accumulated by earlier runs, still proves UI ↔ API wiring.
  const reportRes = await context.request.get('/api/reports/calls')
  expect(reportRes.status()).toBe(200)
  const { summary } = (await reportRes.json()).data as { summary: { total: number; answered: number; abandoned: number; avgDurationS: number } }
  expect(summary.total).toBeGreaterThanOrEqual(1)

  await page.goto('/reports')
  await expect(page.getByRole('link', { name: 'Reports' })).toBeVisible()

  const tiles = page.getByRole('region', { name: 'Call summary' })
  await expect(tiles.getByText('Total calls')).toBeVisible()
  await expect(tiles.getByText(String(summary.total), { exact: true }).first()).toBeVisible()
  await expect(tiles.getByText(`${summary.avgDurationS}s`, { exact: true })).toBeVisible()

  // Open the seeded call (unique SID per run) and verify audio + transcript.
  await page.getByRole('button', { name: new RegExp(callSid) }).click()

  const detail = page.getByRole('region', { name: 'Call detail' })
  const audio = detail.locator('audio')
  await expect(audio).toHaveCount(1)
  const src = await audio.getAttribute('src')
  expect(src).toMatch(/^\/api\/recordings\/[0-9a-f-]+\/media$/)

  await expect(detail.getByText('[dry-run transcript]')).toBeVisible()

  await page.screenshot({
    path: path.resolve(import.meta.dirname, '../../docs/runs/2026-07-16-phase-4-recording/step-12-reports.png'),
    fullPage: true,
  })
})

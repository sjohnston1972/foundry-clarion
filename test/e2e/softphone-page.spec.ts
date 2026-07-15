import { test, expect } from '@playwright/test'
import path from 'node:path'

// Step 13 verification: loads /softphone, asserts the presence roster renders
// from the LIVE org DO socket — a status change through the UI must come back
// over the WebSocket broadcast and update the roster. Signs in AS the seeded
// agent (session email must match an enabled cc_agents row for
// /api/agents/status to accept the change). Ends by going offline, which
// empties the roster — leaving the DO state clean for reruns.
test('presence roster renders live from the DO socket and follows status changes', async ({ page, context }) => {
  const sess = await context.request.post('/api/dev/session', {
    data: { email: 'cara.agent@example.com', orgId: 'org-step13', role: 'owner' },
  })
  expect(sess.status()).toBe(200)

  // Ensure the session user is an enabled agent (409 = already enabled on a rerun).
  const enable = await context.request.post('/api/agents/enable', {
    data: { email: 'cara.agent@example.com' },
  })
  expect([201, 409]).toContain(enable.status())

  await page.goto('/softphone')

  const presence = page.getByRole('region', { name: 'Presence' })
  await expect(presence).toBeVisible()

  // Going available must round-trip: POST /api/agents/status → DO broadcast →
  // our socket → roster row. (The DO for org-step13 starts empty each run —
  // the previous run's teardown set the agent offline, which removes it.)
  await page.getByLabel('Status').selectOption('available')
  const roster = presence.getByRole('list', { name: 'Agent roster' })
  const row = roster.locator('li', { hasText: 'cara.agent@example.com' })
  await expect(row).toBeVisible()
  await expect(row).toContainText('available')

  await page.screenshot({
    path: path.resolve(import.meta.dirname, '../../docs/runs/2026-07-15-phase-3-and-ui/step-13-softphone.png'),
    fullPage: true,
  })

  // Roster follows a second change too — and offline removes the agent
  // (Phase 2 reducer contract), restoring clean state for the next run.
  await page.getByLabel('Status').selectOption('offline')
  await expect(row).toHaveCount(0)
})

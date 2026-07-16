import { test, expect } from '@playwright/test'
import path from 'node:path'

// Step 14 verification: loads /wallboard and asserts a presence tile appears
// for an agent whose status was changed via the API (not the UI) — the tile
// can only get there through the live DO socket. Ends by setting the agent
// offline, emptying the org-step14 roster for clean reruns.
test('a presence tile appears for an agent whose status was changed via the API', async ({ page, context }) => {
  const sess = await context.request.post('/api/dev/session', {
    data: { email: 'dana.agent@example.com', orgId: 'org-step14', role: 'owner' },
  })
  expect(sess.status()).toBe(200)

  const enable = await context.request.post('/api/agents/enable', {
    data: { email: 'dana.agent@example.com' },
  })
  expect([201, 409]).toContain(enable.status())

  await page.goto('/wallboard')
  await expect(page.getByRole('region', { name: 'Agent stats' })).toBeVisible()

  // Status change through the API while the page is open — the tile must
  // arrive over the WebSocket, no reload.
  const status = await context.request.post('/api/agents/status', { data: { status: 'available' } })
  expect(status.status()).toBe(200)

  const tiles = page.getByRole('list', { name: 'Presence tiles' })
  const tile = tiles.locator('li', { hasText: 'dana.agent@example.com' })
  await expect(tile).toBeVisible()
  await expect(tile).toContainText('available')

  await page.screenshot({
    path: path.resolve(import.meta.dirname, '../../docs/runs/2026-07-15-phase-3-and-ui/step-14-wallboard.png'),
    fullPage: true,
  })

  // Clean up live: offline removes the agent from the roster (Phase 2 reducer
  // contract), which the wallboard should also reflect without a reload.
  const offline = await context.request.post('/api/agents/status', { data: { status: 'offline' } })
  expect(offline.status()).toBe(200)
  await expect(tile).toHaveCount(0)
})

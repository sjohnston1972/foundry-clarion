import { test, expect } from '@playwright/test'
import path from 'node:path'

// Step 11 (Phase 4): admin loads /settings, toggles recording on, reloads, and it
// persisted. The consent copy — enabling recording also enables the announcement,
// silent recording unavailable — must be on the screen. Starts by forcing the org
// off via the API so reruns are deterministic. Badge assertions use exact matching:
// getByText's default is case-insensitive substring, which also hits the consent
// paragraph ("…recording on also turns on…") and the toggle button's label.
test('recording toggle persists across reload and the consent copy is present', async ({ page, context }) => {
  const sess = await context.request.post('/api/dev/session', {
    data: { email: 'admin@example.com', orgId: 'org-p4-step11', role: 'owner' },
  })
  expect(sess.status()).toBe(200)

  const reset = await context.request.patch('/api/settings', { data: { recordingEnabled: false } })
  expect(reset.status()).toBe(200)

  await page.goto('/settings')

  // Admin sees the nav entry; the consent copy is on screen.
  await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible()
  await expect(page.getByText('also turns on the caller announcement')).toBeVisible()
  await expect(page.getByText('silent recording is not available')).toBeVisible()

  const region = page.getByRole('region', { name: 'Call recording' })
  const badgeOff = region.getByText('Recording off', { exact: true })
  const badgeOn = region.getByText('Recording on', { exact: true })

  await expect(badgeOff).toBeVisible()
  await region.getByRole('button', { name: 'Turn recording on' }).click()
  await expect(badgeOn).toBeVisible()

  await page.reload()
  await expect(badgeOn).toBeVisible()
  await expect(region.getByRole('button', { name: 'Turn recording off' })).toBeVisible()

  await page.screenshot({
    path: path.resolve(import.meta.dirname, '../../docs/runs/2026-07-16-phase-4-recording/step-11-settings.png'),
    fullPage: true,
  })
})

import { test, expect } from '@playwright/test'
import path from 'node:path'

// Step 10 verification: AppShell renders all four nav items for an
// authorized session, and the signed-out state still shows the sign-in card.
test.describe('AppShell (Step 10)', () => {
  test('a minted dev session sees the shell with all four nav items', async ({ page, context }) => {
    const res = await context.request.post('/api/dev/session', {
      data: { email: 'dev@example.com', orgId: 'org-step10', role: 'owner' },
    })
    expect(res.status()).toBe(200)

    await page.goto('/')
    await expect(page.getByRole('link', { name: 'Softphone' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Agents' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Queues' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Wallboard' })).toBeVisible()

    await page.screenshot({
      path: path.resolve(import.meta.dirname, '../../docs/runs/2026-07-15-phase-3-and-ui/step-10-shell.png'),
      fullPage: true,
    })
  })

  test('signed-out (no cookie) still renders the sign-in card', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible()
  })
})

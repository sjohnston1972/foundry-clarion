import { test, expect } from '@playwright/test'
import path from 'node:path'

// Step 12 verification: signs in via DEV_AUTH, creates a queue, asserts it
// lists with its dry-run WWdryrun_ SID (expected and correct while
// TWILIO_DRY_RUN is on), assigns an agent, screenshots. The queue name is
// unique per run so reruns don't hit the org+name UNIQUE constraint.
test('creates a queue, lists it with its dry-run SID, assigns an agent', async ({ page, context }) => {
  const sess = await context.request.post('/api/dev/session', {
    data: { email: 'admin@example.com', orgId: 'org-step12', role: 'owner' },
  })
  expect(sess.status()).toBe(200)

  // Ensure an enabled agent exists to assign (409 = already enabled on a rerun).
  const enable = await context.request.post('/api/agents/enable', {
    data: { email: 'bea.candidate@example.com' },
  })
  expect([201, 409]).toContain(enable.status())

  await page.goto('/queues')

  const name = `Support ${Date.now()}`
  await page.getByLabel('Queue name').fill(name)
  await page.getByRole('button', { name: 'Create queue' }).click()

  const row = page.getByRole('region', { name: 'Queues' }).locator('li', { hasText: name }).first()
  await expect(row).toBeVisible()
  await expect(row).toContainText('WWdryrun_')

  await row.getByLabel(`Assign agent to ${name}`).selectOption({ label: 'bea.candidate@example.com' })
  await row.getByRole('button', { name: 'Assign' }).click()
  await expect(row.getByRole('list', { name: `Members of ${name}` }).getByText('bea.candidate@example.com')).toBeVisible()

  await page.screenshot({
    path: path.resolve(import.meta.dirname, '../../docs/runs/2026-07-15-phase-3-and-ui/step-12-queues.png'),
    fullPage: true,
  })
})

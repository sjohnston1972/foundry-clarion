import { test, expect } from '@playwright/test'
import path from 'node:path'

// Step 11 verification: signs in via DEV_AUTH, loads /agents, enables the
// seeded Workspace candidate (test/e2e/fixtures/workspace-seed.sql, applied
// once to the local WORKSPACE_DB emulation — see PROGRESS.md Step 11), and
// asserts it now appears in the agent list. Scoped to each labeled <section>
// (not just matching li/text globally) since both cards' rows can contain
// the same email substring.
test('enables a Workspace candidate and it appears in the agent list', async ({ page, context }) => {
  const res = await context.request.post('/api/dev/session', {
    data: { email: 'admin@example.com', orgId: 'org-step11', role: 'owner' },
  })
  expect(res.status()).toBe(200)

  await page.goto('/agents')

  const agentsSection = page.getByRole('region', { name: 'Agents' })
  const candidatesSection = page.getByRole('region', { name: 'Candidates' })
  const candidateRow = candidatesSection.getByText('ada.candidate@example.com')
  const agentRow = agentsSection.locator('li', { hasText: 'ada.candidate@example.com' })

  // Wait for the data (not the skeletons) before branching — locator.count()
  // does NOT auto-wait, so checking it against a still-loading page silently
  // skips the enable step.
  await expect(candidateRow.or(agentRow).first()).toBeVisible()

  // Idempotent across reruns without DB cleanup: the seed always has exactly
  // one candidate for org-step11, so if it's not in the Candidates section, a
  // prior run already enabled it — skip straight to asserting the agent list.
  if (await candidateRow.count() > 0) {
    await candidatesSection.getByRole('button', { name: 'Enable' }).click()
    await expect(candidateRow).toHaveCount(0)
  }

  await expect(agentRow).toBeVisible()
  await expect(agentRow).toContainText('offline')

  await page.screenshot({
    path: path.resolve(import.meta.dirname, '../../docs/runs/2026-07-15-phase-3-and-ui/step-11-agents.png'),
    fullPage: true,
  })
})

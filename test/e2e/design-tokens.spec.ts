import { test, expect } from '@playwright/test'
import path from 'node:path'

// LINCHPIN proof (Step 9): the vendored tokens (src/index.css) and the vendored
// primitives (src/components/ui.tsx) render together correctly — not just that
// the class names apply, but that the CSS custom property values resolve.
test('vendored Card + Button + Badge render with the ported design tokens', async ({ page }) => {
  await page.goto('/test/e2e/design-tokens.html')

  const primary = page.getByRole('button', { name: 'Primary' })
  await expect(primary).toBeVisible()
  await expect(page.getByRole('button', { name: 'Outline' })).toBeVisible()
  await expect(page.getByText('Accent badge')).toBeVisible()
  await expect(page.getByText('Design tokens')).toBeVisible()

  // --color-accent resolves to #00a3ff (rgb(0, 163, 255)) via the vendored
  // @theme block — proves the token pipeline, not just that classes applied.
  const bg = await primary.evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(bg).toBe('rgb(0, 163, 255)')

  await page.screenshot({
    path: path.resolve(import.meta.dirname, '../../docs/runs/2026-07-15-phase-3-and-ui/step-9-tokens.png'),
  })
})

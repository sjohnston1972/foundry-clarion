import { defineConfig } from '@playwright/test'

// Covers test/e2e — Step 9's design-token fixture (Vite alone) plus the
// app-shell/page specs from Step 10 onward, which need a live API: those
// specs hit /api/dev/session, so both the Worker (wrangler dev, DEV_AUTH=true
// via .dev.vars — never committed as a deployed var) and the Vite dev server
// (which proxies /api to it, see vite.config.ts) must be up.
export default defineConfig({
  testDir: './test/e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:5173',
  },
  webServer: [
    {
      command: 'npm run dev:worker',
      url: 'http://localhost:8787/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
})

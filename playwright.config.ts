import { defineConfig } from '@playwright/test'

// Covers only test/e2e — Step 9's design-token verification fixture today,
// the app-shell/page specs from Step 10 onward.
export default defineConfig({
  testDir: './test/e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:5173',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
})

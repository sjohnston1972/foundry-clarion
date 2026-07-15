import { defineConfig } from 'vitest/config'
import path from 'node:path'

// Most modules under test are pure functions, so a node environment is enough.
// Mirror the path aliases from vite.config.ts so '@shared/*' and '@/*' resolve.
// NOTE (2026-07-15): a @cloudflare/vitest-pool-workers 'workers' project was
// attempted and reverted — its isolated storage cannot unlink the DO's SQLite
// on Windows (EBUSY), and isolatedStorage:false never creates the DO persist
// dir (SQLITE_CANTOPEN). See PROGRESS/Blockers of the 2026-07-15 run.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, './shared'),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})

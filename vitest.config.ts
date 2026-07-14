import { defineConfig } from 'vitest/config'
import path from 'node:path'

// Most modules under test are pure functions, so a node environment is enough.
// Mirror the path aliases from vite.config.ts so '@shared/*' and '@/*' resolve.
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

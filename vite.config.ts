import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// Frontend dev server proxies /api to `wrangler dev` (the Worker — see
// CLAUDE.md §8, this stopped being Pages Functions in the Workers migration),
// so the SPA and Worker share one origin in development (no CORS). Uses the
// 'localhost' hostname, not '127.0.0.1' — direct-IP fetches don't resolve to
// the dev server in this environment (see PROGRESS.md Step 9's Playwright note).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, './shared'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
        // Forward WebSocket upgrades too (the presence socket at
        // /api/realtime/socket) — without this the socket dies at the proxy.
        ws: true,
      },
    },
  },
})

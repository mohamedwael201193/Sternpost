import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  timeout: 45_000,
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:4173', viewport: { width: 1440, height: 900 } },
  webServer: process.env.E2E_BASE_URL ? undefined : { command: 'npm run build && npx vite preview --port 4173', port: 4173, reuseExistingServer: true, timeout: 120_000 },
})

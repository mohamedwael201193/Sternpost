import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/node_modules\/(wagmi|viem|@wagmi|@tanstack|ox|abitype|@noble|@scure)/.test(id)) return 'chain'
          if (id.includes('node_modules/react')) return 'react'
        },
      },
    },
  },
  test: { environment: 'jsdom', setupFiles: ['./src/test/setup.ts'], include: ['src/**/*.test.{ts,tsx}'] },
} as any)

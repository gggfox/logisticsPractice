import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@carrier-sales/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
      '@carrier-sales/convex': resolve(__dirname, '../../packages/convex'),
    },
  },
})

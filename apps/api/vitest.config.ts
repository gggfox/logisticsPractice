import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
  },
  resolve: {
    alias: {
      '@carrier-sales/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
})

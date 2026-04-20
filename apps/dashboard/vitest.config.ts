import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    // Vitest defaults to picking up any `*.spec.ts` under the project,
    // which sweeps up our Playwright e2e specs in `e2e/` and trips on
    // `test()` being called outside the Playwright runner. Scope vitest
    // to `src/` only; the e2e suite runs via `pnpm test:e2e`.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@carrier-sales/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
      '@carrier-sales/convex': resolve(__dirname, '../../packages/convex'),
    },
  },
})

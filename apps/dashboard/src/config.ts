/**
 * Dashboard config singleton. `import.meta.env.*` is inlined at build time by
 * Vite, so this module is thin -- no runtime parsing, no Zod, no secrets.
 *
 * Missing `VITE_CONVEX_URL` is a hard error (same contract as the API),
 * surfaced in the browser console so a misconfigured Dokploy **Build Arg**
 * fails loudly instead of silently routing to a placeholder.
 */

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url
}

const rawConvexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined

if (!rawConvexUrl || rawConvexUrl.length === 0) {
  throw new Error(
    'VITE_CONVEX_URL is not set. In Dokploy this must be configured as a Build Arg (not a runtime Env) because Vite inlines it at build time. See docs/dokploy-setup.md.',
  )
}

const normalizedConvexUrl = stripTrailingSlash(rawConvexUrl)
const convexUrlWasNormalized = rawConvexUrl !== normalizedConvexUrl

export const config = {
  convex: {
    url: normalizedConvexUrl,
  },
} as const

declare global {
  // eslint-disable-next-line no-var
  var __CARRIER_SALES_DASHBOARD_CONFIG_PRINTED__: boolean | undefined
}

// Boot log, once per page load. Guarded against module-level re-evaluation
// from tooling (HMR, tests).
if (!globalThis.__CARRIER_SALES_DASHBOARD_CONFIG_PRINTED__) {
  globalThis.__CARRIER_SALES_DASHBOARD_CONFIG_PRINTED__ = true
  const displayed = convexUrlWasNormalized
    ? `${normalizedConvexUrl}  (normalized from "${rawConvexUrl}")`
    : normalizedConvexUrl
  console.info('[config] apps/dashboard', { VITE_CONVEX_URL: displayed })
}

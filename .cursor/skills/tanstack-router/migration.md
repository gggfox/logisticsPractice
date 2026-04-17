# TanStack Router migration playbook

One-time migration from the `useState<Page>` switch in
`apps/dashboard/src/App.tsx` to `@tanstack/react-router` with
file-based routes. The router is already installed
(`@tanstack/react-router` ^1.90.0 in `apps/dashboard/package.json`).

Aim to land this in one PR. Skipping a step tends to leave the
dashboard half-migrated and confusing.

## Checklist

Copy this into the PR description:

```
- [ ] 1. Install devDep + configure Vite plugin (routes file generator)
- [ ] 2. Create `routes/__root.tsx` with Sidebar + <Outlet />
- [ ] 3. Create one route file per page under `routes/`
- [ ] 4. Register `routeTree.gen.ts` + create `router` in `main.tsx`
- [ ] 5. Delete `useState<Page>` from `App.tsx`; App becomes
        `<RouterProvider router={router} />`
- [ ] 6. Replace Sidebar's `onNavigate` prop with `<Link>`
- [ ] 7. Wire Convex client into router context (for loaders)
- [ ] 8. Adopt `validateSearch` for `/loads` (shared schema) and
        `/calls` (dashboard-local Zod)
- [ ] 9. Update Playwright specs to navigate by URL
- [ ] 10. Remove dead code: `Page` type, `pages` record object,
         `onNavigate` plumbing
```

## Step 1. Install devDep + Vite plugin

```bash
pnpm --filter @carrier-sales/dashboard add -D @tanstack/router-plugin
```

In `apps/dashboard/vite.config.ts`, add the plugin **before**
`@vitejs/plugin-react`:

```ts
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    TanStackRouterVite({
      routesDirectory: 'src/routes',
      generatedRouteTree: 'src/routeTree.gen.ts',
      autoCodeSplitting: true,
    }),
    react(),
  ],
})
```

Add `src/routeTree.gen.ts` to `.gitignore` -- it's generated on
every dev/build.

## Step 2. Root layout

`apps/dashboard/src/routes/__root.tsx`:

```tsx
import { Outlet, createRootRouteWithContext } from '@tanstack/react-router'
import type { ConvexReactClient } from 'convex/react'
import { Toaster } from 'sonner'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { Sidebar } from '../components/Sidebar'

export const Route = createRootRouteWithContext<{
  convex: ConvexReactClient
}>()({
  component: RootLayout,
})

function RootLayout() {
  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6 lg:p-8">
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>
      <Toaster position="top-right" richColors />
    </div>
  )
}
```

The dark-mode toggle moves to a `useState` inside `Sidebar` (or a
small `useDarkMode` hook). It's UI-local; it doesn't need a URL.

## Step 3. One route per page

The six pages become six route files. Example -- index:

`apps/dashboard/src/routes/index.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { OverviewPage } from '../pages/OverviewPage'

export const Route = createFileRoute('/')({
  component: OverviewPage,
})
```

`apps/dashboard/src/routes/loads.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { LoadSearchParamsSchema } from '@carrier-sales/shared'
import { LoadBoardPage } from '../pages/LoadBoardPage'

export const Route = createFileRoute('/loads')({
  validateSearch: (search) => LoadSearchParamsSchema.parse(search),
  component: LoadBoardPage,
})
```

Repeat for `live`, `calls`, `carriers`, `negotiations`.

If autoCodeSplitting in the Vite plugin is on (recommended), the
route components are automatically lazy-loaded. If you need manual
control:

```tsx
export const Route = createFileRoute('/loads')({
  validateSearch: ...,
}).lazy(() => import('./loads.lazy').then((d) => d.Route))
```

with `loads.lazy.tsx`:

```tsx
import { createLazyFileRoute } from '@tanstack/react-router'
import { LoadBoardPage } from '../pages/LoadBoardPage'
export const Route = createLazyFileRoute('/loads')({ component: LoadBoardPage })
```

## Step 4. Router in main.tsx

`apps/dashboard/src/main.tsx`:

```tsx
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { ConvexProvider, ConvexReactClient } from 'convex/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { config } from './config'
import { routeTree } from './routeTree.gen'
import './index.css'

const convex = new ConvexReactClient(config.convex.url)

const router = createRouter({
  routeTree,
  context: { convex },
  defaultPreload: 'intent',
})

declare module '@tanstack/react-router' {
  interface Register { router: typeof router }
}

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element not found')

createRoot(rootElement).render(
  <StrictMode>
    <ConvexProvider client={convex}>
      <RouterProvider router={router} />
    </ConvexProvider>
  </StrictMode>,
)
```

`App.tsx` is now either deleted or reduced to a re-export of
`RouterProvider` wrapping. The `pages` record and `Page` type go away
entirely.

## Step 5. Sidebar with <Link>

`apps/dashboard/src/components/Sidebar.tsx` -- props slim down to
`darkMode` / `onToggleDarkMode` (or the hook mentioned above):

```tsx
import { Link, useMatchRoute } from '@tanstack/react-router'

type NavItem = {
  id: string
  to: '/' | '/live' | '/calls' | '/loads' | '/carriers' | '/negotiations'
  label: string
  icon: string
}

const navItems: NavItem[] = [
  { id: 'overview', to: '/', label: 'Overview', icon: '📊' },
  { id: 'live', to: '/live', label: 'Live Feed', icon: '🔴' },
  { id: 'calls', to: '/calls', label: 'Call History', icon: '📞' },
  { id: 'loads', to: '/loads', label: 'Load Board', icon: '🚚' },
  { id: 'carriers', to: '/carriers', label: 'Carriers', icon: '🏢' },
  { id: 'negotiations', to: '/negotiations', label: 'Negotiations', icon: '💰' },
]

export function Sidebar() {
  const matchRoute = useMatchRoute()
  return (
    <aside data-testid="sidebar" className="...">
      <nav data-testid="sidebar-nav" className="flex-1 space-y-1 p-4">
        {navItems.map((item) => {
          const isActive = matchRoute({ to: item.to, fuzzy: false }) !== false
          return (
            <Link
              key={item.id}
              to={item.to}
              data-testid={`sidebar-nav-${item.id}`}
              className={`... ${isActive ? activeClass : inactiveClass}`}
            >
              <span>{item.icon}</span>
              {item.label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
```

Preserve every existing `data-testid` so the e2e suite keeps
working through the migration.

## Step 6. Convex in router context

Router `context` is the cleanest way to share the Convex client into
loaders. The `createRootRouteWithContext<{ convex: ... }>` above is
half of the wiring; the other half is passing `{ convex }` in
`createRouter({ context: { convex } })` (step 4 above).

You don't **need** to add loaders yet. Convex `useQuery` inside page
components keeps working unchanged. Add loaders route-by-route when
you actually want pre-fetch or pending UI.

## Step 7. Update Playwright e2e

`apps/dashboard/e2e/dashboard.spec.ts`:

```ts
// BEFORE
await page.getByText('Load Board').click()
await expect(page.getByText('Search origin')).toBeVisible()

// AFTER
await page.goto('/loads')
await expect(page.getByTestId('sidebar-nav-loads')).toHaveAttribute('data-active', 'true')
// or use a role-based selector for the search input
```

Playwright's `webServer` in `playwright.config.ts` probably already
serves the app; if not, make sure `pnpm --filter @carrier-sales/dashboard dev`
or `preview` is the configured server.

## Step 8. Remove dead code

Final sweep:

- Remove `type Page = 'overview' | ...` from `App.tsx`, `Sidebar.tsx`.
- Remove the `pages: Record<Page, () => JSX.Element>` object.
- Remove `onNavigate` prop from `Sidebar` callers.
- Remove the `ErrorBoundary key={currentPage}` -- the router
  remounts on route change automatically.

## Rollback plan

If the migration goes sideways mid-PR:

1. Leave `@tanstack/react-router` installed (it's already a dep).
2. Revert `main.tsx` to render `<App />`.
3. Delete `src/routes/` and the Vite plugin config.
4. Everything else is additive and safe to leave.

The PR should be one atomic commit (or at least squashed) so revert
is clean.

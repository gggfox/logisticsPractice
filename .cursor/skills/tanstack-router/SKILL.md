---
name: tanstack-router
description: Adopt and use @tanstack/react-router in apps/dashboard -- migrate off useState-based navigation to file-based routes with Zod-validated search params, code-split route components, and URL-driven e2e tests. Use when working on files in apps/dashboard/src that touch navigation (App.tsx, Sidebar.tsx, main.tsx, pages/*.tsx), when starting the router migration, or when authoring a new route after migration.
---

# TanStack Router adoption

`@tanstack/react-router` is in
[apps/dashboard/package.json](../../../apps/dashboard/package.json)
but unused. The dashboard currently switches pages with
`useState<Page>` in
[App.tsx](../../../apps/dashboard/src/App.tsx) and a handler-prop
sidebar in
[Sidebar.tsx](../../../apps/dashboard/src/components/Sidebar.tsx).
This skill is a **one-time migration playbook** + the long-term
conventions that apply after.

Quick reference: `.cursor/rules/tanstack-router.mdc`. Migration:
[migration.md](migration.md).

## Why migrate

- URLs become the source of truth. Shareable links, back/forward,
  deep-linking into filtered views (`/calls?outcome=booked`).
- Route-level code splitting cuts initial bundle size -- today every
  page is in the root chunk.
- Playwright e2e gets stable via `page.goto('/loads')` instead of
  `page.getByText('Load Board').click()`.
- Search params get Zod validation for free via `validateSearch`.

## Migration status

**Not started.** The skill's first section is the playbook to get
from "installed but unused" to "routing works". The second section is
the rules that apply once routing is in place.

The step-by-step migration lives in [migration.md](migration.md) so
this SKILL.md stays under 500 lines. Start there.

## Long-term conventions (post-migration)

### File layout

```
apps/dashboard/src/
  routes/
    __root.tsx            <- layout + Sidebar + <Outlet />
    index.tsx             <- '/'  -> OverviewPage
    live.tsx              <- '/live'
    calls.tsx             <- '/calls'   (validateSearch with Zod)
    loads.tsx             <- '/loads'   (validateSearch with LoadSearchParamsSchema)
    carriers.tsx          <- '/carriers'
    negotiations.tsx      <- '/negotiations'
  routeTree.gen.ts        <- generated, do NOT edit
  pages/                  <- existing page components, unchanged
  components/Sidebar.tsx  <- uses <Link>, no onNavigate prop
  main.tsx                <- <RouterProvider router={router} />
```

Route files under `routes/` are *thin*: they define the route, pull
its search params, and render the existing page component from
`pages/`. Don't move business logic into the route file.

### Route skeleton

```tsx
// routes/loads.tsx
import { createFileRoute } from '@tanstack/react-router'
import { LoadSearchParamsSchema } from '@carrier-sales/shared'
import { LoadBoardPage } from '../pages/LoadBoardPage'

export const Route = createFileRoute('/loads')({
  validateSearch: (search) => LoadSearchParamsSchema.parse(search),
  component: LoadBoardPage,
})
```

Rules:

- `validateSearch` uses a **shared Zod schema** where one exists
  (`LoadSearchParamsSchema` lives in `@carrier-sales/shared` for
  exactly this reason). Inline `z.object({...})` only for
  dashboard-only search keys (e.g. UI-only sort order).
- `component` is the default-exported page. `React.lazy` is built
  into TanStack Router via `createFileRoute(...).lazy(...)` -- see
  [migration.md](migration.md) for the lazy variant.
- `loader` is **optional**. Prefer Convex `useQuery` in the page
  component; Convex's reactive layer handles updates. Use `loader`
  only when the route needs data *before first paint* (rare).

### Search params in the component

```tsx
export function LoadBoardPage() {
  const { origin, equipment_type } = Route.useSearch()
  const navigate = Route.useNavigate()

  const onFilterChange = (next: Partial<LoadSearchParams>) => {
    navigate({ search: (prev) => ({ ...prev, ...next }) })
  }
  // ...
}
```

- `Route.useSearch()` returns the validated, parsed output.
- `navigate({ search })` takes a full object or an updater function.
- Never `new URLSearchParams(window.location.search)`; the router is
  the only way to read search state.

### Links, not handlers

After migration the sidebar uses `<Link>`:

```tsx
// Sidebar.tsx (after)
import { Link, useMatchRoute } from '@tanstack/react-router'

const matchRoute = useMatchRoute()
const isActive = matchRoute({ to: item.to, fuzzy: false }) !== false

<Link
  to={item.to}
  data-testid={`sidebar-nav-${item.id}`}
  className={isActive ? activeClass : inactiveClass}
>
  {item.icon} {item.label}
</Link>
```

The old `onNavigate: (page: Page) => void` prop goes away. Current
`data-testid="sidebar-nav-*"` attributes **stay** -- Playwright tests
already use them.

### Loaders (when you do need them)

```tsx
export const Route = createFileRoute('/calls/$callId')({
  loader: async ({ params, context }) => {
    const [call, transcript] = await Promise.all([
      context.convex.query(api.calls.getById, { id: params.callId }),
      context.convex.query(api.calls.getTranscript, { id: params.callId }),
    ])
    return { call, transcript }
  },
  component: CallDetailPage,
})
```

- Kick off queries in **parallel** with `Promise.all`. Serial `await`
  chains are waterfalls.
- Return a value; the component reads it via `Route.useLoaderData()`.
- `context.convex` comes from the root route's `context`; see
  [migration.md](migration.md).

### `beforeLoad` is for auth / flags, not data

```tsx
beforeLoad: ({ context, location }) => {
  if (!context.auth.isAuthed) {
    throw redirect({ to: '/login', search: { redirect: location.href } })
  }
}
```

No data fetching. Data belongs in `loader`.

### Error + pending

```tsx
createFileRoute('/loads')({
  component: LoadBoardPage,
  pendingComponent: () => <PageSkeleton />,
  errorComponent: ({ error }) => <PageError error={error} />,
})
```

Set these at the route level so the user sees something during
navigation. Page-internal spinners (already present in
`OverviewPage` via `summary === undefined`) keep working for Convex
live data.

### Outlet and layout

`__root.tsx` owns the chrome:

```tsx
export const Route = createRootRoute({
  component: () => (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6 lg:p-8">
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>
      <Toaster position="top-right" richColors />
    </div>
  ),
})
```

No conditional page rendering via state. One `<Outlet />`; TanStack
picks the right child from the current URL.

### Navigation in event handlers

```tsx
const navigate = useNavigate()
onClick={() => navigate({ to: '/calls', search: { outcome: 'booked' } })}
```

Never `window.location.assign(...)` / `history.push(...)`. Never
`<a href>` for internal navigation (full reload).

## Interaction with other rules

- **Zod contracts** (`.cursor/rules/zod-contracts.mdc`): schemas used
  in `validateSearch` are imported from `@carrier-sales/shared`
  through the package root. No deep imports.
- **Testing** (`.cursor/rules/testing.mdc`): post-migration, e2e
  tests navigate via `page.goto('/loads')` and assert on route-scoped
  `data-testid`s.
- **React best practices** (existing
  `.cursor/rules/react-best-practices.mdc`): loaders use
  `Promise.all` to avoid Convex waterfalls, same rule as
  page-internal hooks.

## Checklist

Before merging a new route:

- [ ] File is `apps/dashboard/src/routes/<path>.tsx`
- [ ] Uses `createFileRoute('/path')({ ... })`
- [ ] `validateSearch` uses a shared schema when one applies
- [ ] `component` points at an existing `pages/*Page` (no business
      logic in the route file)
- [ ] `loader` is absent unless data-before-first-paint is needed
- [ ] `beforeLoad` contains no data fetches
- [ ] Navigation uses `<Link>` / `useNavigate`, never
      `window.location`
- [ ] `data-testid`s on nav elements preserved / added in the
      `sidebar-nav-*` style
- [ ] No `useState<Page>` anywhere in the dashboard

# Dashboard UI

The operator cockpit that visualises everything the voice agent and Bridge API
do. It's a single‑page React app that reads from Convex over a live WebSocket,
so every number on screen updates as calls land, loads are booked, and rates
are countered — no polling, no manual refresh.

Source lives under [`apps/dashboard`](../apps/dashboard). This doc explains how
it's wired to the rest of the system, what the layout primitives and component
kit guarantee, and how to extend it.

---

## 1. Role in the system

```
Carrier (phone)
      │
      ▼
HappyRobot Voice AI ────▶ Bridge API (Fastify)
                                │        │
                                │        ├─▶ FMCSA QCMobile
                                │        └─▶ Redis / BullMQ
                                ▼
                         Convex (documents)
                                │   live subscriptions (WS)
                                ▼
                       ┌─────────────────────┐
                       │  Dashboard (React)  │  ← you are here
                       └─────────────────────┘
```

The dashboard is a **pure read path**. It never writes to Convex and never
calls the Fastify API directly:

- All list/detail reads go through **Convex queries** (`api.calls.getAll`,
  `api.loads.getAll`, `api.metrics.getSummary`, …). The client pushes updates
  over WebSocket whenever a mutation on the server touches the underlying
  tables.
- Writes (new calls, negotiation rounds, booking state, metric rollups) are
  performed by **Fastify routes / workers** in `apps/api` calling Convex
  mutations from `packages/convex`. The dashboard just renders whatever the
  subscription emits.
- There is no shared session or cookie between the dashboard and the API —
  auth on the API side is API‑key / HMAC only, and those keys live
  server‑side.

This separation is deliberate: the dashboard can be pointed at any Convex
deployment (dev, staging, prod) without touching the API surface, and the API
can be redeployed without affecting live dashboard clients beyond the data
they subscribe to.

---

## 2. Tech stack

| Concern              | Choice                                  | Notes |
|----------------------|-----------------------------------------|-------|
| Framework            | React 19 + Vite 6                       | `createRoot` + `StrictMode` in [`main.tsx`](../apps/dashboard/src/main.tsx). |
| Data                 | `convex/react` (`ConvexReactClient`)    | Provider wraps the app; queries use `useQuery`. |
| Styling              | Tailwind CSS 3 + CSS custom properties  | Tokens in [`tailwind.config.ts`](../apps/dashboard/tailwind.config.ts), surface vars in [`index.css`](../apps/dashboard/src/index.css). |
| Icons                | `lucide-react` (strokeWidth ≤ 1.75)     | No emojis anywhere in the UI. |
| Charts               | `recharts`                              | Sparklines on `StatCard`, bar/pie/scatter in pages. |
| Maps                 | `leaflet` (`LoadMap.tsx`)               | Loads rendered as pins. |
| Motion               | `framer-motion`                         | Sidebar width spring, `StatCard` stagger. |
| Toasts               | `sonner`                                | Mounted once in `App.tsx`. |
| Typecheck / lint     | `tsc --noEmit`, `biome check src/`      | See `package.json` scripts. |
| Unit tests           | Vitest + Testing Library + jsdom        | `test-setup.ts`. |
| E2E                  | Playwright against `vite preview`       | `e2e/*.spec.ts`, selectors are `data-testid`. |

---

## 3. Environment and build

The dashboard takes **one** environment variable, inlined at build time:

```
VITE_CONVEX_URL=https://<project>.convex.cloud
```

It's consumed by [`src/config.ts`](../apps/dashboard/src/config.ts), which
throws on missing/empty values and normalises away a trailing slash. In dev
the resolved URL is logged once to the browser console for sanity.

Because Vite **inlines** `import.meta.env.VITE_*` into the JS bundle, in
Dokploy this must be passed as a **Build Arg**, not a runtime env var (see
[`dokploy-setup.md`](./dokploy-setup.md)). The same goes for any future
`VITE_*` toggles — treat them as compile‑time constants.

Scripts (from `apps/dashboard/package.json`):

```bash
pnpm --filter @carrier-sales/dashboard dev          # vite dev server
pnpm --filter @carrier-sales/dashboard build        # production bundle to dist/
pnpm --filter @carrier-sales/dashboard preview      # serve dist/ for e2e
pnpm --filter @carrier-sales/dashboard typecheck    # tsc --noEmit
pnpm --filter @carrier-sales/dashboard lint         # biome check src/
pnpm --filter @carrier-sales/dashboard test         # vitest run
pnpm --filter @carrier-sales/dashboard test:e2e     # playwright test
```

---

## 4. Data flow

### 4.1 Subscriptions

Every page reads through `useQuery` from `convex/react`:

```tsx
// apps/dashboard/src/pages/OverviewPage.tsx
const summary = useQuery(api.metrics.getSummary) as MetricsSummary | undefined
const history = useQuery(api.metrics.getHistory, { limit: 24 }) as
  MetricsHistoryRow[] | undefined
```

`useQuery` returns `undefined` while the first round‑trip is in flight. Every
page treats `undefined` as **loading** and renders a skeleton or placeholder;
it never falls back to zero values, which would look like real "no data".

Queries wired up today:

| Page                | Convex queries                                  |
|---------------------|--------------------------------------------------|
| Overview            | `metrics.getSummary`, `metrics.getHistory`       |
| Call History        | `calls.getAll`                                   |
| Load Board          | `loads.getAll`                                   |
| Carriers            | `carriers.getAll`, `calls.getAll`                |
| Negotiations        | `negotiations.getAll`, `calls.getAll`            |

When a Fastify route / worker runs `convexService.*` on the server,
Convex pushes the new row to every subscribed client. There is no imperative
refresh path in the UI.

### 4.2 Empty states vs loading

- **Loading** (`data === undefined`): skeleton placeholders. Never "0 calls".
- **Empty** (`data.length === 0`): `EmptyState` with a lucide icon + copy
  (e.g. `SlidersHorizontal` when filters hide all rows).
- **Error** (thrown from the query or a child render): caught by
  `ErrorBoundary` keyed on the current page so switching pages resets the
  boundary.

### 4.3 Shared types

Runtime contracts (`EQUIPMENT_TYPES`, `LOAD_STATUSES`, outcome/sentiment
enums) come from [`packages/shared`](../packages/shared) and are re‑exported
where the dashboard needs them. The dashboard does not define its own DTOs —
if a field changes, it changes in `packages/shared` / `packages/convex` first.

---

## 5. Visual system

### 5.1 Design tokens

Defined in [`tailwind.config.ts`](../apps/dashboard/tailwind.config.ts) and
[`index.css`](../apps/dashboard/src/index.css):

- **Typography**
  - `font-display` — Instrument Serif (page titles, KPI numerics rendered in
    a serif display size).
  - `font-sans` — Geist (all body copy and UI chrome).
  - `font-mono` — Geist Mono (MC numbers, rates, round history, anything
    numeric that should line up).
- **Colour**
  - `surface-0 / surface-1 / surface-2 / surface-border` — warm neutral
    canvas, driven by CSS custom properties so dark mode flips atomically via
    the `.dark` class on `<html>`.
  - `accent` — amber (`#f59e0b`) is the **single action accent**: active nav
    bar, focus rings, hover reveals, branded chips. Reserve it for
    user‑initiated emphasis.
  - Outcome palette — emerald (booked), rose (declined / frustrated), amber
    (negative), slate (neutral / no‑match), sky (transferred). Mapped inside
    `Badge` so pages don't hand‑roll colours.
  - `brand.*` — legacy blue scale, kept for back‑compat; prefer `accent` for
    new work.
- **Elevation / radius**
  - `shadow-card`, `shadow-card-hover` — hairline + soft lift, never a hard
    drop shadow.
  - `rounded-xl2` (14px) — default card radius.
- **Motion**
  - `ease-spring` cubic‑bezier, used for the sidebar collapse and StatCard
    entrance.

Utility classes exposed for common patterns:

- `.eyebrow` — 11px uppercase tracked label.
- `.hairline` — 80%‑opacity border colour from `surface-border`.
- `.numeric` — `font-mono tabular-nums` for columns of numbers.

### 5.2 Layout primitives

```
<App>
 ├─ <Sidebar />                                     (collapsible, framer-motion)
 └─ <div flex-col>
     ├─ <Topbar />                                  (sticky, 56px)
     └─ <main data-testid="page-main">
         └─ <PageComponent>                         (one of six pages)
             └─ <PageLayout mode="scroll"|"fixed">
                 ├─ header  (eyebrow + title + description + actions)
                 └─ body    (scroll OR flex-1 overflow-hidden)
```

The single rule that kept us out of double‑scroll hell:

> `<main>` owns page padding + scroll policy. Pages never wrap themselves in
> a `p-6` or `overflow-y-auto`. They declare a `mode` on `PageLayout` and let
> the primitive pick the right container.

- `mode="scroll"` (default) — page header is flush, body scrolls vertically.
  Used by Overview, Load Board, Carriers, Negotiations.
- `mode="fixed"` — body is `flex-1 overflow-hidden`; children manage their
  own internal scroll (sticky table headers, virtualised feeds). Used by
  Call History.

Both the main column and `<main>` carry `min-w-0` so that flex children like
wide tables constrain themselves to available width instead of pushing
horizontal scroll up to the viewport.

### 5.3 Component kit

Located in [`apps/dashboard/src/components`](../apps/dashboard/src/components):

| Component           | Purpose |
|---------------------|---------|
| `Sidebar`           | 6 nav items (`lucide` icons), serif "Cs" monogram, amber left‑bar active state, theme toggle in the footer. Collapses `w-60 → w-16` with a spring; persists via `aria-label` for collapsed mode. |
| `layout/Topbar`     | Global chrome: sidebar toggle, search trigger (placeholder `⌘K`), notifications bell, avatar. |
| `layout/PageLayout` | Page shell (see 5.2). |
| `StatCard`          | Small‑caps label + icon tile + serif numeric + delta + sparkline. Staggered entrance animation via `index` prop. Replaces the old `KpiCard`. |
| `SectionHeader`     | Eyebrow + serif title + optional actions. Sits above every chart well. |
| `EmptyState`        | Lucide icon tile + title + description + optional CTA, centred. |
| `Badge`             | `variant="outcome"|"sentiment"|"status"|"plain"` + `tone` maps to a palette; pages never open‑code chip colours. |
| `ErrorBoundary`     | Keyed on `currentPage` so navigation resets a crashed tree. |
| `LoadMap`           | Leaflet map, full‑bleed inside the Load Board card. |

### 5.4 Keyboard shortcuts & a11y

- `[` toggles the sidebar (ignored inside inputs / textareas).
- All interactive elements have `focus-visible:ring-2 focus-visible:ring-accent-500/40`.
- Collapsed nav items keep their `aria-label` and a native `title` tooltip.
- Colour contrast is paired for WCAG AA on both `surface-0` and the dark
  equivalent; status/outcome chips use foreground ≥ 4.5:1 against their
  tinted background.

---

## 6. Pages

| Page                          | Mode    | Shape |
|-------------------------------|---------|-------|
| `OverviewPage`                | scroll  | 4 `StatCard`s (calls, booking rate, revenue, avg rounds) with sparklines, then cardless wells for calls‑over‑time (line), outcome distribution (pie), and sentiment (bar). |
| `CallHistoryPage`             | fixed   | Filter bar + sticky‑header table; body scrolls, page does not. Badges use `variant="outcome"` / `variant="sentiment"`. |
| `LoadBoardPage`               | scroll  | Filter/search card, full‑bleed Leaflet map, then a cardless list of matching loads. |
| `CarrierIntelPage`            | scroll  | Search + sortable table, eligibility chip via `Badge`, hover accent on rows. |
| `NegotiationPage`             | scroll  | 3 `StatCard`s (total, acceptance rate, median rounds), bar + scatter charts, round‑by‑round history. |

Every page imports from `@/components/layout/PageLayout` and starts with:

```tsx
return (
  <PageLayout
    eyebrow="…"
    title="…"
    description="…"
    mode="scroll"            // or "fixed"
    actions={…}              // optional right-side controls
  >
    {/* page body */}
  </PageLayout>
)
```

---

## 7. Testing

### 7.1 Unit (Vitest)

- Runner: `pnpm --filter @carrier-sales/dashboard test`.
- Environment: `jsdom` via `test-setup.ts`.
- Convention: put tests next to source in `__tests__/*.test.tsx` when/if
  added; pure formatters live in [`src/lib/formatters.ts`](../apps/dashboard/src/lib/formatters.ts)
  and should be the first thing covered.

### 7.2 E2E (Playwright)

- Runner: `pnpm --filter @carrier-sales/dashboard test:e2e`.
- Specs: [`apps/dashboard/e2e/*.spec.ts`](../apps/dashboard/e2e).
- The Playwright config spins up `vite preview` on a fixed port; run
  `pnpm --filter @carrier-sales/dashboard build` first if you want to iterate
  against a pre‑built bundle.
- Selectors: **prefer `data-testid`** over text. The UI guarantees these
  test IDs are stable even when copy changes:
  - `sidebar`, `sidebar-nav`, `sidebar-nav-{overview|calls|loads|carriers|negotiations}`, `sidebar-theme-toggle`
  - `topbar`
  - `page-main`
  - Page‑specific IDs (tables, cards, filters) — see each page source.

### 7.3 What e2e tests are allowed to touch

E2e runs against real Convex only if you provide `VITE_CONVEX_URL`. For
CI / local loops the expected pattern is to keep e2e focused on **chrome
and navigation** — pages should be resilient to empty datasets because all
queries render an `EmptyState` rather than crashing.

---

## 8. Extending the UI

### 8.1 Adding a page

1. Create `apps/dashboard/src/pages/MyPage.tsx` that renders a `PageLayout`.
2. Add the page to the `Page` union and `pages` record in
   [`App.tsx`](../apps/dashboard/src/App.tsx).
3. Add a nav entry in `navItems` inside
   [`Sidebar.tsx`](../apps/dashboard/src/components/Sidebar.tsx) with a
   `lucide-react` icon (no emojis).
4. Add a `data-testid="sidebar-nav-<id>"` — the Sidebar does this
   automatically from the `id`.
5. Use `useQuery(api.<module>.<name>, …)` for data. Treat `undefined` as
   loading, handle empty with `EmptyState`.

### 8.2 Adding a metric to Overview

- Extend the server rollup in `packages/convex/convex/metrics.ts` so
  `metrics.getSummary` returns the new field.
- Add a `<StatCard>` to `OverviewPage.tsx` with a `lucide` icon, a
  `formatCurrency` / `formatPercent` / `formatNumber` value, and an `index`
  so the entrance stagger stays in order.
- If a sparkline is desired, add a compatible `series` prop reading from
  `metrics.getHistory`.

### 8.3 Adding a badge variant

`Badge` is the only place in the UI that maps a domain token to a colour.
Extend the variant tables in
[`components/Badge.tsx`](../apps/dashboard/src/components/Badge.tsx) rather
than inlining tinted classNames on the consumer. This is what keeps
outcomes / sentiments / statuses visually consistent across pages.

### 8.4 Icons, emojis, and decorative glyphs

- Use `lucide-react`. If the icon you want is missing, upgrade
  `lucide-react`; do not reach for emojis.
- Icons always pair with text or an `aria-label`. Never use an icon as the
  only affordance in a link/button without a label.
- Stroke width 1.75 for resting icons, 2 for active/accented icons.

### 8.5 Data contracts

If you need a field the dashboard doesn't have:

1. Add it to the Zod schema in `packages/shared`.
2. Add/update the Convex schema and index in `packages/convex/convex/schema.ts`
   and the relevant query.
3. Only then read it from the dashboard via `useQuery`.

Never widen a type in a single `.tsx` file — that's how contract drift
starts.

---

## 9. Gotchas

- **Build‑time env**: `VITE_CONVEX_URL` is baked into the bundle. If you
  rotate Convex projects, you must rebuild and redeploy — restarting the
  container is not enough.
- **Dark mode**: toggled by adding `.dark` to `<html>`. All
  dashboard‑authored styles must use `dark:` variants; do **not** rely on
  `prefers-color-scheme` media queries.
- **Strict mode remounts**: `StrictMode` double‑invokes effects in dev.
  Anything imperative (map init, WebSocket handlers) must be idempotent.
- **Flex + tables**: any ancestor of a wide `<table>` must carry `min-w-0`
  or the table will blow out the layout. `App.tsx` and `PageLayout` already
  do this; new wrappers must preserve it.
- **Strict‑mode e2e matches**: Sidebar copy can collide with in‑page
  text (e.g. brand string vs. hero subtitle). Prefer
  `getByTestId('sidebar-nav-<id>')` over `getByText`.

---

## 10. File map

```
apps/dashboard/
├── index.html                       # font preconnect, root div
├── tailwind.config.ts               # tokens (fonts, accent, surface, shadow)
├── postcss.config.cjs
├── vite.config.ts
├── playwright.config.ts
└── src/
    ├── main.tsx                     # Convex provider + createRoot
    ├── App.tsx                      # shell: sidebar + topbar + main
    ├── config.ts                    # VITE_CONVEX_URL guard
    ├── index.css                    # surface vars, utility layer
    ├── components/
    │   ├── Badge.tsx                # variant → palette map
    │   ├── EmptyState.tsx
    │   ├── ErrorBoundary.tsx
    │   ├── LoadMap.tsx              # Leaflet wrapper
    │   ├── SectionHeader.tsx
    │   ├── Sidebar.tsx              # lucide nav, framer-motion collapse
    │   ├── StatCard.tsx             # icon + numeric + sparkline
    │   └── layout/
    │       ├── PageLayout.tsx       # scroll | fixed mode
    │       └── Topbar.tsx
    ├── hooks/
    ├── lib/
    │   └── formatters.ts            # currency / percent / number / date
    └── pages/
        ├── OverviewPage.tsx
        ├── CallHistoryPage.tsx
        ├── LoadBoardPage.tsx
        ├── CarrierIntelPage.tsx
        └── NegotiationPage.tsx
```

For deployment, see [`docs/dokploy-setup.md`](./dokploy-setup.md); for the
API contract the dashboard ultimately reflects, see
[`docs/acme-logistics-solution.md`](./acme-logistics-solution.md).

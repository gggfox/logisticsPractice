---
name: testing
description: Write Vitest unit tests and Playwright end-to-end tests for the monorepo with the right selectors, fixture discipline, and no hidden network. Use when adding or modifying files under **/__tests__/*.test.ts, packages/*/src/**/*.test.ts, apps/dashboard/e2e/*.spec.ts, or when deciding whether a test belongs in unit vs e2e.
---

# Testing

Two kinds of tests in the repo:

- **Vitest unit** (`*.test.ts` next to the source in `__tests__/`).
  Pure, no network, no Convex.
- **Playwright e2e** (`apps/dashboard/e2e/*.spec.ts`). Real browser,
  running dashboard, but the backend is either seeded Convex or a
  controlled fixture.

Quick reference: `.cursor/rules/testing.mdc`. Reference tests:
[fmcsa.service.test.ts](../../../apps/api/src/services/__tests__/fmcsa.service.test.ts),
[negotiation-logic.test.ts](../../../apps/api/src/steps/bridge/__tests__/negotiation-logic.test.ts),
[load.schema.test.ts](../../../packages/shared/src/schemas/__tests__/load.schema.test.ts),
[dashboard.spec.ts](../../../apps/dashboard/e2e/dashboard.spec.ts).

## Where a test belongs

| Question | Answer |
| --- | --- |
| Pure function (no I/O, no Date, no random)? | Vitest, co-located. |
| Fastify route that only wires a service? | Do not test in isolation. Extract the pure part, test *that*. |
| Convex query / mutation? | Convex has its own harness; skip until / unless needed. |
| Dashboard page renders + a user can navigate? | Playwright e2e. |
| Visual / layout regression? | Not covered; don't add without discussion. |

## Vitest conventions

### File placement & naming

```
apps/api/src/services/fmcsa.service.ts
apps/api/src/services/__tests__/fmcsa.service.test.ts
```

Co-located `__tests__/` folder, file name `<source>.test.ts`. One
test file per unit; no shared `test-helpers.ts` unless it has at
least three consumers.

### Import, don't copy

Current `fmcsa.service.test.ts` duplicates `evaluateEligibility` into
the test file because the function isn't exported. That is a bug to
fix, not a pattern to copy:

```ts
// fmcsa.service.ts  -- EXPORT the pure helper
export function evaluateEligibility(carrier: {...}) { /* ... */ }

// fmcsa.service.test.ts
import { evaluateEligibility } from '../fmcsa.service.js'
```

If you write a test that duplicates logic, stop and refactor the
source instead.

### Fixtures: typed and const

```ts
const validLoad = {
  load_id: 'LOAD-0001',
  equipment_type: 'dry_van' as const,
  status: 'available' as const,
  loadboard_rate: 2500,
  // ...
}
```

- `as const` on every enum member so the fixture's inferred type
  narrows to the schema's literal union.
- No `any`, no `as any`. If you're forced to cast, the schema is
  probably what's wrong.
- Construct from a base and spread for variants:
  `{ ...validLoad, loadboard_rate: -1 }`.

### Determinism

- No `new Date()` in assertion values. Use fixed ISO strings
  (`'2026-04-20T08:00:00.000Z'`).
- No `Math.random()`.
- If code under test reads `Date.now()`, inject a clock
  (`(deps: { now: () => number }) => ...`) or use Vitest's fake timers
  (`vi.useFakeTimers()` + `vi.setSystemTime(...)`). The latter is
  process-global; prefer injection.

### No real network

No `*.test.ts` file may hit a real URL. Options, in order of preference:

1. **Extract the pure function** and test it without `fetch`
   altogether. This is the right answer 80% of the time.
2. **Inject a client factory.** Instead of `fetch(...)` baked in,
   accept `(client: { fetch: typeof fetch }) => ...`; pass a stub.
3. **MSW** at the test-entry level for integration tests that
   legitimately need an HTTP boundary. Do not `vi.stubGlobal('fetch',
   ...)` per test -- MSW handles ordering, passthrough, and
   cleanup.

MSW sketch for a bridge-API-shape server:

```ts
// __tests__/setup/msw.ts
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

export const server = setupServer(
  http.get('https://mobile.fmcsa.dot.gov/qc/services/carriers/:mc', () =>
    HttpResponse.json({ content: { carrier: { /* ... */ } } }),
  ),
)

// vitest.config.ts -> test.setupFiles: ['./__tests__/setup/msw.ts']
// in setup file:
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
```

### Coverage

- `--coverage` runs in CI but nothing gates on it.
- Don't chase 100% on pass-through code (Fastify routes that `return
  await service.foo()`). Those are covered by e2e, not unit.
- Do aim for 100% on pure domain logic (negotiation, eligibility).

## Playwright conventions

### Selector priority

Always go down this list; stop at the first stable match:

1. **`getByRole('button', { name: 'Save' })`** -- uses the
   accessibility tree; stable across copy tweaks as long as the role
   is correct.
2. **`getByLabel('Email')`** -- for form inputs with a `<label>`.
3. **`getByTestId('kpi-card-total-calls')`** -- use existing
   `data-testid` attributes. `OverviewPage.tsx` already sets
   `data-testid="kpi-card-*"`; `Sidebar.tsx` sets
   `data-testid="sidebar-nav-*"`. Add new ones in the same style.
4. **`getByText('...')`** -- last resort. Only when the text is the
   UX contract (a heading or a single-word empty state). Break on copy
   changes is the cost.

### Migration example

Current dashboard e2e leans on `getByText`:

```ts
// BEFORE -- in dashboard.spec.ts
await page.getByText('Load Board').click()
await expect(page.getByText('Search origin')).toBeVisible()
```

After the TanStack Router migration
(`.cursor/skills/tanstack-router/SKILL.md`) this should read:

```ts
// AFTER -- stable and matches URL contract
await page.goto('/loads')
await expect(page.getByRole('searchbox', { name: 'Search origin' })).toBeVisible()
// or, before routes:
await page.getByTestId('sidebar-nav-loads').click()
```

### Assertions

- `expect(locator).toBeVisible()` / `toBeHidden()` / `toHaveText(...)`
  / `toHaveClass(/.../ )`. These auto-retry.
- Never `expect(await locator.textContent()).toBe(...)`; that's a
  one-shot read that flakes.
- `page.waitForTimeout(...)` is a code smell. Wait for the thing
  you actually need (a locator, a URL, a network response).

### Test scope

One spec file per page or per user journey:

```
apps/dashboard/e2e/
  dashboard.spec.ts         -- navigation + shell
  call-history.spec.ts      -- filtering / sorting the call table
  load-board.spec.ts        -- search / detail drilldown
```

Don't write 30 assertions in one test; a failing assertion stops the
test. Prefer small tests that tell you which feature broke.

## Checklist

### Adding a Vitest test

- [ ] Lives in `<source-dir>/__tests__/<source>.test.ts`
- [ ] Imports the function under test (no duplication)
- [ ] Fixtures use `as const` on enum members
- [ ] No `any`, no real network, no `new Date()` in assertion values
- [ ] One concern per `describe`, one behavior per `it`

### Adding a Playwright test

- [ ] `getByRole` / `getByLabel` / `getByTestId` before `getByText`
- [ ] Navigates by URL where routing allows it
- [ ] Auto-retrying `expect(locator).*` matchers only
- [ ] No `page.waitForTimeout`
- [ ] New `data-testid`s follow the existing `kpi-card-*` /
      `sidebar-nav-*` style

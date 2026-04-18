---
name: convex-patterns
description: Author Convex schema tables, queries, mutations, and service calls for packages/convex with this project's index-first, validator-matched conventions. Use when adding or modifying files under packages/convex/convex, wiring a new table or index, fixing slow queries that full-scan, or deciding between query/mutation/action.
---

# Convex patterns for `packages/convex`

Convex is the system-of-record for loads, carriers, calls, negotiations,
and metric snapshots. Fastify routes and BullMQ workers read/write via `convexService` (see
`apps/api/src/services/convex.service.ts`); the dashboard reads via
`useQuery`. This skill captures the project-local conventions.

Quick reference: `.cursor/rules/convex-patterns.mdc`.

## Tables & indexes (the map)

Live in [packages/convex/convex/schema.ts](../../../../packages/convex/convex/schema.ts):

| Table | Primary business id | Existing indexes |
| --- | --- | --- |
| `loads` | `load_id` | `by_load_id`, `by_status`, `by_equipment`, `by_origin` |
| `carriers` | `mc_number` | `by_mc_number`, `by_eligible` |
| `calls` | `call_id` | `by_call_id`, `by_started_at`, `by_outcome`, `by_carrier` |
| `negotiations` | `call_id` (+ `round`) | `by_call_id`, `by_call_round` |
| `metrics` | `timestamp` | `by_timestamp` |

Rule: if you're about to write `.filter(q => q.eq(q.field('x'), ...))` and
`x` is a business id, **stop and add `by_x` to the table first**, then
rewrite as `.withIndex('by_x', q => q.eq('x', arg))`. Index definitions
cost nothing at write time compared to table scans at read time.

## Writing a query

```ts
import { v } from 'convex/values'
import { query } from './_generated/server'

export const getByLoadId = query({
  args: { load_id: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('loads')
      .withIndex('by_load_id', (q) => q.eq('load_id', args.load_id))
      .first()
  },
})
```

- `args` block -- always declare validators, even for "just a string".
- `.withIndex(name, (q) => q.eq(field, arg))` -- not `.filter()`.
- `.first()` -- returns `T | null`, caller handles null.
- For list queries, prefer `.take(N)` (bounded) over `.collect()`
  (unbounded). `getAll` exists on calls/loads/negotiations today but should
  not be called from the dashboard on hot paths.

## Writing a mutation

```ts
export const upsert = mutation({
  args: {
    load_id: v.string(),
    origin: v.string(),
    /* ... every field with v.* validator matching the Zod schema ... */
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('loads')
      .withIndex('by_load_id', (q) => q.eq('load_id', args.load_id))
      .first()

    if (existing) {
      await ctx.db.patch(existing._id, args)
      return existing._id
    }
    return await ctx.db.insert('loads', args)
  },
})
```

Patterns:

- **Upsert** -- index lookup -> `patch` or `insert`. Return the `_id`.
- **Update status / field** -- index lookup -> `patch({ field: value })`.
  Throw `new Error(\`Load ${id} not found\`)` if missing.
- **Append (immutable log)** -- `insert` only. See `negotiations.logRound`.

## Partial patches

When the update has optional fields (e.g. `updateOutcome` on calls):

```ts
const patch: Record<string, unknown> = { outcome: args.outcome }
if (args.sentiment !== undefined) patch.sentiment = args.sentiment
if (args.final_rate !== undefined) patch.final_rate = args.final_rate
await ctx.db.patch(call._id, patch)
```

This is the only reason to use `Record<string, unknown>`. If every field is
always present, pass a typed object literal.

## Validator mirror of the Zod schema

The Convex args must match the Zod schema in `packages/shared/src/schemas`
field-for-field. See `.cursor/skills/zod-contracts/SKILL.md` for the
mapping table. Common mismatches:

| Zod | Correct Convex | Wrong |
| --- | --- | --- |
| `z.string().datetime()` | `v.string()` | `v.number()` (epoch temptation) |
| `z.string().optional()` | `v.optional(v.string())` | `v.string()` |
| `z.number().positive()` | `v.number()` | `v.float64()` (doesn't exist) |
| `z.enum(CALL_OUTCOMES)` | `v.string()` | trying to encode the enum in Convex |

Convex does not enforce enum membership -- rely on the Zod layer on the
inbound side (Fastify route `body` Zod schema) and the enum tuple in the dashboard.

## Query vs mutation vs action

| Primitive | Can read DB | Can write DB | Can call external APIs |
| --- | --- | --- | --- |
| `query` | yes | no | no |
| `mutation` | yes | yes | no |
| `action` | via `runQuery` | via `runMutation` | yes |

This project has **no actions**. External calls (FMCSA verify, HappyRobot
classify) live in Fastify routes and BullMQ workers, which call
`convexService` for persistence. Do not introduce an action without a
strong reason -- the rationale is that Fastify routes / workers already
have observability wiring, retries (via BullMQ), and config, and splitting
the external call into a Convex action duplicates that stack.

## Cross-table reads without waterfalls

Bad (waterfall; each await blocks the next):

```ts
for (const call of calls) {
  const load = call.load_id ? await ctx.db.query('loads').withIndex(...).first() : null
  // ...
}
```

Good (`Promise.all` -- parallel):

```ts
const loads = await Promise.all(
  calls.map((c) =>
    c.load_id
      ? ctx.db.query('loads').withIndex('by_load_id', (q) => q.eq('load_id', c.load_id!)).first()
      : Promise.resolve(null),
  ),
)
```

This same rule applies to cron jobs iterating over calls (see
`apps/api/src/cron/aggregate-metrics.cron.ts`'s `computeTopLanes`,
which currently serializes -- replace with `Promise.all` when touched).

Convex enforces a per-transaction read budget; unbounded waterfalls will
hit it before `Promise.all` does.

## Timestamps

Always ISO strings (`v.string()`). To sort by time, add a
`.index('by_<field>_at', ['field_at'])` and query:

```ts
await ctx.db.query('calls').withIndex('by_started_at').order('desc').take(50)
```

Never store `Date` or epoch numbers. The Zod layer enforces ISO via
`z.string().datetime()`.

## Not-found: throw in mutations, null in queries

```ts
// mutation
if (!load) throw new Error(\`Load ${args.load_id} not found\`)

// query
return await ctx.db.query('loads').withIndex(...).first()  // T | null
```

The Fastify route (or worker) maps the mutation throw to 500 (or reshapes
it to 404 explicitly if expected). Queries let the caller decide.

## Verification

After editing:

```bash
pnpm --filter @carrier-sales/convex typecheck
pnpm --filter @carrier-sales/convex dev   # optional, regenerates _generated/
```

Check that:

- [ ] Every new field in a table has a matching Zod field + validator
- [ ] Every lookup by a business id uses `.withIndex('by_<field>', ...)`
- [ ] New mutations throw on not-found; new queries return null
- [ ] No new `action` was introduced (if yes, justify in the PR)
- [ ] No loop-with-await for cross-table reads

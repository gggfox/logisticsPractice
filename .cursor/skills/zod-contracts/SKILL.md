---
name: zod-contracts
description: Author and evolve Zod schemas in packages/shared that are the shared contract between apps/api (Fastify), packages/convex, and apps/dashboard. Use when adding or changing schemas in packages/shared/src/schemas, adding a DB field, wiring a new API response, or debugging zod-v3/v4 typecheck errors at the fastify-type-provider-zod boundary.
---

# Zod contracts for `@carrier-sales/shared`

This package holds the Zod schemas + inferred types that the Fastify API,
the Convex database, and the Dashboard all consume. The whole point is: one
schema, three consumers. Drifts here show up as silent undefined fields in
the dashboard or runtime errors on Convex insert -- but rarely as a clean
type error.

Quick reference: `.cursor/rules/zod-contracts.mdc`.

## Mental model

```
               +-- apps/api (Fastify)       -> route `schema.body` / `schema.response`
@carrier-sales/shared ----+-- packages/convex           -> mirror as v.string()/v.number()
               +-- apps/dashboard          -> useQuery/render with z.infer<>
```

A field lives in four places:

1. `*.schema.ts` (source of truth)
2. `schemas/index.ts` (explicit re-export)
3. `packages/convex/convex/schema.ts` (`v.*` validator on the same field)
4. Consumers (Fastify route, BullMQ worker, dashboard component) via `z.infer<>`

## File template

```ts
// packages/shared/src/schemas/<domain>.schema.ts
import { z } from 'zod'
import { SOME_ENUM } from '../constants/index.js'

export const <Name>Schema = z.object({
  <id>_id: z.string().min(1),
  created_at: z.string().datetime(),
  status: z.enum(SOME_ENUM).default(SOME_ENUM[0]),
  amount: z.number().positive(),
  note: z.string().default(''),
})

export type <Name> = z.infer<typeof <Name>Schema>
```

Then in `schemas/index.ts`:

```ts
export {
  <Name>Schema,
  type <Name>,
} from './<domain>.schema.js'
```

Do **not** `export * from './<domain>.schema.js'`. Explicit re-exports catch
typos + make public API audits trivial.

## Field-by-field conventions

| Kind | Use | Don't use | Why |
| --- | --- | --- | --- |
| Business id | `z.string().min(1)` | `z.string()` | Empty ids break Convex indexes silently |
| Optional id | `z.string().min(1).optional()` | `z.string().optional().default('')` | Optional vs default-empty are different downstream |
| Timestamp | `z.string().datetime()` | `z.date()`, `z.number()` | Convex is `v.string()`; external APIs send ISO |
| Money / rate | `z.number().positive()` | `z.number()` | Matches DB `v.number()` + loud on 0/negative |
| Count | `z.number().int().nonnegative()` | `z.number()` | Enables int check before DB insert |
| Enum | `z.enum(CONST_TUPLE)` | inline `z.enum([...])` | One edit site when adding values |
| Record body | `z.record(z.unknown())` | `z.object({}).passthrough()` | Typed as `Record<string, unknown>` downstream |

## Splitting internal vs external schemas

External payloads (FMCSA, HappyRobot) change on a vendor cadence. Internal
shapes change on our cadence. Keep them separate even when they mostly
overlap:

```ts
export const CarrierSchema = z.object({               // internal
  mc_number: z.string().min(1),
  legal_name: z.string().min(1),
  is_eligible: z.boolean(),
  verified_at: z.string().datetime(),
})

export const FMCSACarrierResponseSchema = z.object({  // external
  content: z.object({
    carrier: z.object({
      legalName: z.string(),
      mcNumber: z.string().optional(),
      allowedToOperate: z.string(),
    }),
  }),
})
```

The service / step that calls FMCSA parses with the external schema then
maps to the internal one. Never try to parse a raw FMCSA response with
`CarrierSchema`.

## Request vs response schemas

Requests (validated by `schema.body` on a Fastify route) are usually
narrower than the stored entity:

```ts
export const OfferRequestSchema = z.object({
  call_id: z.string().min(1),
  load_id: z.string().min(1),
  carrier_mc: z.string().min(1),
  offered_rate: z.number().positive(),
})

export const OfferResponseSchema = z.object({
  accepted: z.boolean(),
  counter_offer: z.number().positive().optional(),
  round: z.number().int().min(1).max(MAX_NEGOTIATION_ROUNDS),
  max_rounds_reached: z.boolean(),
  message: z.string(),
})
```

Use the request schema's `z.infer<>` type in the route handler. With
`.withTypeProvider<ZodTypeProvider>()` + `schema: { body: ... }`,
`req.body` is already typed from the schema -- you don't need a
manual `z.infer<>`.

## Adding a field -- three-step checklist

Copy this into your PR description and tick off each:

```
Adding `foo` to Load:
- [ ] Added `foo: z.string().min(1)` to LoadSchema in load.schema.ts
- [ ] Added `foo: v.string()` to loads table in packages/convex/convex/schema.ts
- [ ] `convex codegen` / dashboard typecheck clean
- [ ] Any Fastify route returning Load re-typechecks (it uses LoadSchema directly)
```

If the field is optional: use `z.string().min(1).optional()` + `v.optional(v.string())`.

If the field is an enum: edit `packages/shared/src/constants/index.ts` first,
then reference via `z.enum(NEW_CONST)`.

## The Zod v3 <-> v4 bridge

`@carrier-sales/shared` is on Zod v3. Some transitive deps (and some
versions of `fastify-type-provider-zod`) ship Zod v4 types. Runtime is
identical (`.safeParse` is compatible), but the type systems don't
unify. The whole repo has **one** named cast site:

```ts
// apps/api/src/lib/zod-schema.ts
export const asStepSchema = (schema: ZodTypeAny): StepSchemaInput =>
  schema as unknown as StepSchemaInput
```

Use `asStepSchema(LoadSchema)` only at that boundary if a response
schema refuses to typecheck. Do **not**:

- Paste the cast inline (`SomeSchema as unknown as StepSchemaInput`).
- Introduce a second helper with a different name.
- Import zod from a transitive dep's node_modules to "work around"
  the mismatch.

If you see a `ZodObject<...>` assignability error at a route's
`response` map, the fix is `asStepSchema(...)`, not a broader cast.

## Consuming the types

In the API (`apps/api`):

```ts
import { OfferRequestSchema, type OfferRequest } from '@carrier-sales/shared'

const parsed = OfferRequestSchema.safeParse(req.body)
if (parsed.success) {
  const data: OfferRequest = parsed.data
}
```

In the dashboard (`apps/dashboard`):

```ts
import type { Load } from '@carrier-sales/shared'

function LoadRow({ load }: { load: Load }) { /* ... */ }
```

Never re-derive the type by hand. Never deep-import
(`from '@carrier-sales/shared/schemas/load.schema'` is not exposed).

## Verification

After editing a schema, run:

```bash
pnpm --filter @carrier-sales/shared build
pnpm --filter @carrier-sales/api typecheck
pnpm --filter @carrier-sales/dashboard typecheck
pnpm --filter @carrier-sales/convex typecheck
```

(Substitute the actual package names from each `package.json` if they differ.)

A schema PR that doesn't touch `packages/convex/convex/schema.ts` is almost
always incomplete -- double-check whether the new field needs to persist.

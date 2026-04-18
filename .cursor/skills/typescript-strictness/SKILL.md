---
name: typescript-strictness
description: Write TypeScript that passes the repo's strict tsconfig and Biome lints without casts -- noUncheckedIndexedAccess, exactOptionalPropertyTypes, no any, no non-null assertions. Use when editing any .ts or .tsx file, adding a new type, resolving a typecheck error with a cast, or introducing branded IDs for LoadId / CallId / McNumber.
---

# TypeScript strictness

The repo's TS config is **strict-strict**: `strict`,
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`noImplicitReturns` all on. Biome bans `any` and non-null assertions.
Writing "fight the compiler with casts" TypeScript just shifts bugs to
runtime. This skill is about staying compliant by default.

Quick reference: `.cursor/rules/typescript-strictness.mdc`. Config:
[tsconfig.base.json](../../../tsconfig.base.json),
[biome.json](../../../biome.json).

## The four compiler flags

| Flag | What it catches | How to write code that passes |
| --- | --- | --- |
| `strict` | Null/undefined misuse, implicit `any`, etc. | Narrow with guards; type your function params. |
| `noUncheckedIndexedAccess` | `arr[i]` and `record[k]` return `T \| undefined`. | Narrow: `const x = arr[0]; if (!x) return ...`. No `arr[0]!`. |
| `exactOptionalPropertyTypes` | `{ foo?: string }` forbids explicit `{ foo: undefined }`. | Omit the key instead of assigning `undefined`. |
| `noImplicitReturns` | Missing `return` in some branch. | Return from every branch or `throw`. |

### `noUncheckedIndexedAccess` in practice

```ts
// BAD -- `x` is `string | undefined`; the `!` is a lie.
const first = items[0]!

// GOOD
const first = items[0]
if (!first) return { status: 404, body: /* ... */ }
useFirst(first)

// GOOD -- destructure with a guard
const [first] = items
if (first === undefined) throw new Error('expected non-empty')
```

For `Record<string, T>`:

```ts
// BAD
const color = COLORS[key]
doThing(color.hex)

// GOOD
const color = COLORS[key] ?? DEFAULT_COLOR
```

### `exactOptionalPropertyTypes` in practice

`{ reason?: string }` accepts `{ reason: 'x' }` and `{}`. It does
**not** accept `{ reason: undefined }`.

```ts
type Result = { eligible: boolean; reason?: string }

// BAD
const r: Result = { eligible: true, reason: undefined }

// GOOD -- omit the key
const r: Result = eligible
  ? { eligible: true }
  : { eligible: false, reason }
```

Ternaries or spreads work:

```ts
return {
  eligible,
  ...(reason !== undefined && { reason }),
}
```

## Biome rules -- treat as errors in review

`biome.json` has `style.noNonNullAssertion` and
`suspicious.noExplicitAny` as `warn`. In review, treat them as
blockers.

### No `any`

For genuinely untyped external data (webhook body, third-party
response), use `z.unknown()` + parse, never `any`:

```ts
// BAD
function handle(body: any) { return body.user.id }

// GOOD
function handle(body: unknown) {
  const parsed = PayloadSchema.parse(body)
  return parsed.user.id
}
```

`unknown` forces you to parse before use; `any` compiles whatever
you write next.

### No `!` non-null assertion

Every `!` is "I know better than the compiler". Prefer:

- **Narrowing**: `if (x) { useX(x) }`.
- **Nullish coalescing**: `const n = maybeNum ?? 0`.
- **Zod parse**: if the value comes from outside, parse it; if
  parsing succeeds, the field is no longer optional.

Only time `!` can be defensible: trailing `!` on a `document
.getElementById(...)` right before a `throw` that would already handle
it. And even then, an explicit guard is clearer.

## `as const satisfies T`

This is the single pattern that shows up everywhere in the repo:

```ts
export const config = {
  name: 'FindLoad',
  triggers: [/* ... */],
  flows: ['bridge-api'],
} as const satisfies StepConfig
```

Why `satisfies` over `as`:

- `as T` silently widens. If the object *violates* `T`, `as` hides it.
- `satisfies T` verifies the value matches `T` **without** widening
  the inferred literal types. `config.name` stays `'FindLoad'`, not
  `string`. `Handlers<typeof config>` then derives exact handler types.
- `as const` locks literals: `'FindLoad'` is `'FindLoad'`, not
  `string`; `['bridge-api']` is `readonly ['bridge-api']`.

Use `satisfies` for:

- Configuration objects where you want literal inference and type
  checking at the same time (e.g. `config.ts`, Zod enum tuples).
- Lookup tables: `const ROLES = { admin: { canEdit: true }, user: {
  canEdit: false } } as const satisfies Record<string, { canEdit:
  boolean }>`.

## Discriminated unions over nullable pairs

```ts
// BAD -- four possible states, two of which are invalid.
type Result = { data?: Foo; error?: string }

// GOOD -- two states, compiler enforces the xor.
type Result =
  | { ok: true; data: Foo }
  | { ok: false; error: string }

if (result.ok) {
  result.data  // typed
} else {
  result.error // typed
}
```

Applies especially to:

- Service call results (`verifyCarrier` returning ok/error).
- API responses in the dashboard (`MetricsSummary | undefined` is OK
  for "loading"; `{ data?, error? }` is not).

## Fastify handler typing

Routes declare `params` / `querystring` / `body` Zod schemas in the
route `schema`, and the `.withTypeProvider<ZodTypeProvider>()` call
makes `req.params` / `req.query` / `req.body` typed from those
schemas. The rule is: never reach for `as` to type a request field --
declare it in the schema instead.

```ts
// BAD -- untyped access, no runtime validation.
app.get('/api/v1/loads/:load_id', async (req) => {
  const { load_id } = req.params as { load_id: string }
  // ...
})

// GOOD -- typed + validated.
app.withTypeProvider<ZodTypeProvider>().get(
  '/api/v1/loads/:load_id',
  { schema: { params: z.object({ load_id: z.string().min(1) }) } },
  async (req) => {
    const { load_id } = req.params  // typed string
  },
)
```

Invalid input 400s automatically with a Zod error message before the
handler runs.

## Branded IDs

Right now `LoadId`, `CallId`, `McNumber` are plain `string`. Nothing
stops:

```ts
await getLoad(call_id)  // compiles, crashes at Convex
```

Brands fix that at zero runtime cost:

```ts
// packages/shared/src/types/index.ts
export type LoadId = string & { readonly __brand: 'LoadId' }
export type CallId = string & { readonly __brand: 'CallId' }
export type McNumber = string & { readonly __brand: 'McNumber' }

// Constructors -- only place a plain string becomes a brand.
export const toLoadId = (s: string): LoadId => s as LoadId
export const toCallId = (s: string): CallId => s as CallId
export const toMcNumber = (s: string): McNumber => s as McNumber
```

Migration recipe (don't mass-migrate):

1. Add the brand types + constructors.
2. In each Zod schema, `.transform(toLoadId)` after the string check
   so parsed output carries the brand.
3. Change function signatures at the **outer boundary** first:
   `getLoad(id: LoadId)`, `verifyCarrier(mc: McNumber)`.
4. Inner callers start getting type errors where they pass a plain
   string. Fix each by routing through a constructor or a parsed
   schema.
5. Stop once it's uncomfortable; come back later. Half-migrated is
   fine -- the protected boundaries are the ones that matter.

## Don't hand-derive types

If a Zod schema exists, `z.infer` from it:

```ts
// BAD -- drifts silently when LoadSchema changes
type Load = { load_id: string; origin: string; destination: string /* ... */ }

// GOOD
import { LoadSchema } from '@carrier-sales/shared'
type Load = z.infer<typeof LoadSchema>
// Or, as done in packages/shared: export the type alongside the schema.
```

The only place a hand-written type is justified is an `interface`
that exists purely for docs (JSX props, public API sketches) -- and
even then, prefer `type Props = z.infer<typeof PropsSchema>` when a
schema exists.

## The one allowed cast

`as unknown as T` is only allowed in
[apps/api/src/lib/zod-schema.ts](../../../apps/api/src/lib/zod-schema.ts)
for the Zod v3<->v4 bridge (`asStepSchema`). Adding another cast site
is a design decision that needs review, not an inline workaround.

## Checklist

- [ ] No `any` (use `unknown` + parse)
- [ ] No `!` non-null assertion (narrow, or use `??`)
- [ ] `as const satisfies T` for configs, not `as T`
- [ ] Destructured array/record access guarded (no `arr[0]!`)
- [ ] No explicit `undefined` assigned to `foo?: T` properties
- [ ] Discriminated unions, not optional-pair result types
- [ ] `z.infer<typeof FooSchema>` for shared types
- [ ] Cast sites (`as`, `as unknown as`) are confined to the
      audited helper, not sprinkled through handlers

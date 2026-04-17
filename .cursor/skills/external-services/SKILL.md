---
name: external-services
description: Author external HTTP service clients for apps/api/src/services (FMCSA, HappyRobot, etc.) with timeouts, safe retries, Zod parsing, and secret-safe error handling. Use when adding or modifying a service that calls a third-party API, when wiring an external call into a Motia step, or when a service leaks secrets / retries unsafely / has unbounded fetches.
---

# External service clients

Third-party clients live in `apps/api/src/services/*.service.ts`. The two
reference implementations are
[fmcsa.service.ts](../../../apps/api/src/services/fmcsa.service.ts) and
[happyrobot.service.ts](../../../apps/api/src/services/happyrobot.service.ts).
This skill codifies the conventions they share so new services land the
same way.

Quick reference: `.cursor/rules/external-services.mdc`. Related:
`.cursor/rules/wide-event-logging.mdc`, `.cursor/rules/api-security.mdc`.

## Client shape

Keep each service module small: a private `fetch` helper + exported
named functions per endpoint. No classes, no singletons beyond the
module itself.

```ts
import { SomeResponseSchema } from '@carrier-sales/shared'
import { config } from '../config.js'

async function serviceFetch(path: string, init: RequestInit = {}) {
  const response = await fetch(`${config.vendor.baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.vendor.apiKey}`,
      ...init.headers,
    },
    signal: AbortSignal.timeout(15_000),
  })

  if (!response.ok) {
    // Status only. No URL (may carry query secrets), no body (may echo keys).
    throw new Error(`Vendor API ${response.status}: ${response.statusText}`)
  }

  return response.json()
}

export async function getThing(id: string) {
  const raw = await serviceFetch(`/api/v1/things/${id}`)
  return SomeResponseSchema.parse(raw)
}
```

## Timeouts

| Vendor | Timeout | Why |
| --- | --- | --- |
| FMCSA | `10_000` ms | Public government API, historically flaky. |
| HappyRobot | `15_000` ms | Transcripts can be large; still must bound. |

Every `fetch` **must** pass `signal: AbortSignal.timeout(ms)`. An
unbounded fetch will hold a Motia worker indefinitely when the vendor
goes dark.

## Retry policy

Retry only **safe, idempotent** calls. The default is "no retry".

FMCSA `GET /carriers/:mc` is the canonical retryable call:

```ts
let lastError: Error | null = null
for (let attempt = 0; attempt < 3; attempt++) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: 'application/json' },
    })
    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(`FMCSA API returned ${response.status}: ${response.statusText}`)
    }
    return FMCSACarrierResponseSchema.parse(await response.json())
  } catch (error) {
    lastError = error instanceof Error ? error : new Error(String(error))
    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
    }
  }
}
throw lastError ?? new Error('FMCSA request failed after 3 retries')
```

Rules:

- Linear backoff (`1000 * (attempt + 1)`). Not exponential; the request
  budget is short (~15s worst case).
- Max 3 attempts. More than that and you're papering over a vendor
  outage -- fail fast and let the wide event catch it.
- Never retry `POST` / `PUT` / `DELETE` unless the endpoint is
  documented idempotent.
- Do not catch-and-swallow. The final throw is required so the Motia
  step can turn it into a 5xx with `failure_stage`.

## 404 vs error

`404` is a value ("not found"), not an exception. Translate it to
`null` (or a domain-specific sentinel) and let the caller decide. Only
`5xx` / network / parse failures throw.

## Zod parsing

External JSON is untyped input. Parse it:

```ts
return FMCSACarrierResponseSchema.parse(await response.json())
```

- Never cast: `as FMCSACarrierResponse` is forbidden.
- External schemas live next to internal schemas in
  `packages/shared/src/schemas/` but are **separate** from internal
  shapes (`FMCSACarrierResponseSchema` != `CarrierSchema`). The service
  maps external -> internal. See `.cursor/rules/zod-contracts.mdc`.

## Secrets in errors

The URL, headers, and response body may all contain secrets. Errors
must carry **status only**:

```ts
// GOOD
throw new Error(`FMCSA API returned ${response.status}: ${response.statusText}`)

// BAD -- leaks webKey in logs / Sentry
throw new Error(`Failed to GET ${url}`)

// BAD -- leaks bearer echo from vendor error body
throw new Error(`HappyRobot error: ${await response.text()}`)
```

Same rule applies to `ctx.logger.error` in the calling step: log
`{ mc_number, status }`, never `{ url, headers }`.

## Config, not env

All service modules import from
[config.ts](../../../apps/api/src/config.ts). `process.env` anywhere
in `apps/api/src/services/**` is a bug -- the config module is the
single audited boundary that parses, validates, and masks every secret
at boot.

## Caching

Two-tier pattern, Convex is authoritative:

1. Read from Convex (`convexService.carriers.getByMcNumber(mc)`).
2. If cached and `Date.now() - verified_at < TTL`, return cached.
3. Otherwise fetch the vendor, parse, upsert to Convex, return.

Do **not** add an in-memory `Map` to the module. Motia spawns workers;
a per-worker cache is both inconsistent across workers and lost on
restart. If a hot cache is genuinely needed, put it in Redis (already
in the stack) with an explicit TTL.

## Pure logic goes in the module, not the test

The current test file duplicates `evaluateEligibility` from
`fmcsa.service.ts` because the function isn't exported. Do the
opposite: **export pure helpers** from the service and import them in
tests.

```ts
// fmcsa.service.ts
export function evaluateEligibility(carrier: {
  allowedToOperate: string
  statusCode: string
  oosDate?: string
}): { eligible: boolean; reason?: string } { /* ... */ }

// __tests__/fmcsa.service.test.ts
import { evaluateEligibility } from '../fmcsa.service.js'
```

Pure functions never touch `fetch`, Convex, or `Date.now()` directly
unless time is injected.

## Handoff to the Motia step

Steps call services and classify errors:

```ts
try {
  const result = await verifyCarrier(mc_number)
  enrichWideEvent(ctx, { eligible: result.is_eligible, status: result.operating_status })
  return { status: 200, body: result }
} catch (error) {
  enrichWideEvent(ctx, { failure_stage: 'fmcsa_verify' })
  ctx.logger.error('Carrier verification failed', {
    mc_number,
    error: error instanceof Error ? error.message : String(error),
  })
  return {
    status: 502,
    body: { error: 'Bad Gateway', message: 'Carrier verification unavailable', statusCode: 502 },
  }
}
```

- 502 (not 500) when an upstream vendor failed; the call itself was
  valid, the dependency isn't.
- `failure_stage` names the vendor call (`fmcsa_verify`,
  `happyrobot_transcript`), not the generic `external_api`.
- Do **not** echo the vendor error message to the client.

## Checklist

Before committing a new or edited service module:

- [ ] Every `fetch` has `signal: AbortSignal.timeout(ms)`
- [ ] Retries are limited to safe GETs; max 3 attempts; linear backoff
- [ ] `404` returns `null`; only `!response.ok` and network errors throw
- [ ] Response is parsed with a Zod schema (no `as`, no `any`)
- [ ] Thrown errors contain status only, no URL / headers / body
- [ ] `config.*` is used; no `process.env.*`
- [ ] Pure helpers are **exported** for tests to import
- [ ] No in-memory caching; TTL lives in Convex / Redis

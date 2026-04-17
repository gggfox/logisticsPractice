---
name: api-security
description: Harden Motia API endpoints with API-key auth, rate limiting, and HMAC webhook signature verification; handle secrets safely via config. Use when writing or modifying middleware in apps/api/src/middleware, webhook steps in apps/api/src/steps/webhooks, or any code that touches api keys, bearer tokens, webhook secrets, or HMAC signatures.
---

# API security

The Bridge API has three guarantees: (1) every public endpoint is rate
limited, (2) every public endpoint requires an API key, (3) every
webhook verifies an HMAC-SHA256 signature on the raw body. This skill
codifies how to keep those guarantees intact.

Quick reference: `.cursor/rules/api-security.mdc`. Related:
`.cursor/rules/motia-steps.mdc`,
`.cursor/rules/wide-event-logging.mdc`.

## Threat model (short)

- The public internet can hit `api.<host>/**`. Only `/api/v1/health`
  is allowed through unauthenticated.
- HappyRobot calls our bridge with `x-api-key`.
- HappyRobot calls our webhook with `x-webhook-signature` (HMAC-SHA256
  of the raw body, keyed by `WEBHOOK_SECRET`).
- The rate limiter exists to cap budget for *anyone* with a key,
  including ourselves -- not just anonymous traffic.

## Middleware order

HTTP bridge endpoints (`apps/api/src/steps/bridge/**`):

```ts
middleware: [rateLimiter, apiKeyAuth, wideEventMiddleware]
```

Webhook endpoints (`apps/api/src/steps/webhooks/**`):

```ts
middleware: [apiKeyAuth, wideEventMiddleware]
```

Fixed rules:

- `wideEventMiddleware` is **last**. It wraps `next()` in try/finally
  so it always observes the final status and captures errors.
- `rateLimiter` runs **before** `apiKeyAuth`. Rejecting 401s without
  charging budget means an attacker can flood us without being rate
  limited. Keep the order.
- Webhooks skip the rate limiter: HappyRobot is a known caller, the
  signature is the gate, and legitimate burst traffic (end of a call
  batch) should not 429.

## API key auth

Shape is fixed; copy from
[api-key-auth.ts](../../../apps/api/src/middleware/api-key-auth.ts):

```ts
export const apiKeyAuth: ApiMiddleware = async (req, ctx, next) => {
  if (ctx.trigger.path === '/api/v1/health') return next()

  const apiKey = req.headers['x-api-key']
  if (!apiKey) {
    return {
      status: 401,
      body: { error: 'Unauthorized', message: 'Missing x-api-key header', statusCode: 401 },
    }
  }

  const validKeys = [config.bridge.apiKey, config.bridge.adminKey]
  if (!validKeys.includes(apiKey as string)) {
    return {
      status: 401,
      body: { error: 'Unauthorized', message: 'Invalid API key', statusCode: 401 },
    }
  }

  return next()
}
```

Rules:

- The 401 response body is identical for "missing" vs "invalid". No
  info leakage.
- Comparison is `.includes(...)` on a two-element array: the set is
  tiny and fixed, and both values come from `config.*`. If the set
  grows, switch to `crypto.timingSafeEqual` on a per-key basis -- but
  don't prematurely add it here; `.includes` is fine for N=2.
- The bypass is **path-based** on `ctx.trigger.path`, not on a header.
  A header-based bypass is an immediate auth escape.

### Adding a new bypass

Before adding another `if (ctx.trigger.path === '...')` branch:

1. Ask: could the endpoint require a key instead? (Usually yes.)
2. If no (e.g. public OpenAPI docs), add a comment naming the caller
   and the reason. Prefer a separate unauthenticated router if you
   have more than one such path.

## Rate limiter

Reference: [rate-limiter.ts](../../../apps/api/src/middleware/rate-limiter.ts).

- Keyed by `x-api-key` header, falling back to `'anonymous'`. Never
  key by `x-forwarded-for` / IP alone -- Traefik sets that header
  from a client-controlled value.
- Limits live in `packages/shared/src/constants/index.ts` (`RATE_LIMIT`).
  Bump deliberately; they're shared with docs.
- Stores state in an in-process `Map`. For a multi-worker deployment,
  this means each worker has its own budget. Acceptable today (one
  worker), but if scaling horizontally becomes a need, move state to
  Redis (already in the stack) keyed by `x-api-key`.
- On 429, return `Retry-After` in seconds and
  `{ error, message, statusCode }` in the body.

## Webhook signature verification

Reference: [call-completed.step.ts](../../../apps/api/src/steps/webhooks/call-completed.step.ts).

```ts
import crypto from 'node:crypto'

function verifyWebhookSignature(rawBody: string, signature: string | undefined): boolean {
  if (!signature) return false
  const secret = appConfig.bridge.webhookSecret
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  const sigBuf = Buffer.from(signature, 'hex')
  const expBuf = Buffer.from(expected, 'hex')
  if (sigBuf.length !== expBuf.length) return false
  return crypto.timingSafeEqual(sigBuf, expBuf)
}
```

The three mistakes this guards against:

1. **Length mismatch throws.** `timingSafeEqual` on unequal-length
   buffers throws `ERR_CRYPTO_TIMING_SAFE_EQUAL_INVALID_LENGTH`. That
   turns into a 500 (and unlogged signature failure). Always
   length-guard first.
2. **`JSON.stringify(req.body)` reorders keys.** HMAC is computed
   client-side over the exact bytes the client sent. If you
   re-serialize, any key reordering or whitespace difference flips the
   hash. Use the raw body. The current `call-completed.step.ts` uses
   `JSON.stringify(req.body)` as a shortcut -- it works only because
   HappyRobot and Node emit keys in the same order today. If you're
   adding a new webhook, get the raw body instead (Motia exposes it on
   the request; check the platform version in use).
3. **Missing signature header.** Short-circuit to `false`; do not
   compute HMAC on an empty string and compare.

After verification, always:

- `enrichWideEvent(ctx, { signature_valid: boolean })`
- `webhookReceivedCounter.add(1, { signature_valid: 'true' | 'false' })`
- On `false`, `logger.warn('Invalid webhook signature')` -- this
  stands alone from the wide event because it needs real-time alerting.

## Secrets

The full list of secrets in this repo:

- `BRIDGE_API_KEY`, `ADMIN_API_KEY` (inbound API key auth)
- `WEBHOOK_SECRET` (HMAC key)
- `FMCSA_WEB_KEY` (query-string secret on FMCSA URLs)
- `HAPPYROBOT_API_KEY` (bearer to HappyRobot)
- `CONVEX_DEPLOY_KEY` (admin, dev-only)

All of them:

- Are declared in [config.ts](../../../apps/api/src/config.ts) with
  `requiredString(...)` (fail fast at boot).
- Appear masked via `maskSecret(...)` in the boot summary, never raw.
- Are imported via `config.*` -- never `process.env.*` anywhere else.

### Never

- Log a secret: `ctx.logger.info('key', { apiKey })` -- no.
- Return a secret in a response body (even an error).
- Include a secret in a URL logged to wide event (`url: fmcsaUrl`).
  URLs can have query-string secrets.
- Embed a secret in a thrown `Error` message (it flows to Sentry,
  SigNoz logs, and any log aggregator).

### For correlation, hash

`wide-event.middleware.ts` hashes the api key to 12 chars:

```ts
function hashApiKey(key: string | undefined): string | undefined {
  if (!key) return undefined
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 12)
}
```

Emitted as `api_key_hash`. That's enough to distinguish bridge from
admin traffic in queries without revealing the secret.

## Adding a new secret

1. Add a `requiredString('MY_SECRET')` entry to `EnvSchema` in
   `config.ts`.
2. Group it under `export const config = { ..., myThing: { secret: env.MY_SECRET } }`.
3. Add `kv('myThing.secret', maskSecret(config.myThing.secret))` to
   `printBootSummary`.
4. Update `.env.example` and `docs/dokploy-setup.md` with the new var.
5. **Never** consume it outside `config.ts`.

## Checklist

- [ ] Middleware order matches the rule's table for the endpoint kind
- [ ] No new path-based bypass in `apiKeyAuth` without a comment
- [ ] Webhook verifier length-guards before `timingSafeEqual`
- [ ] Webhook HMACs the raw body, not a re-serialized object
- [ ] 401 response body is the shared `{ error, message, statusCode }`
- [ ] No `process.env.*` outside `config.ts`
- [ ] Secrets never appear in logs, responses, or thrown messages
- [ ] `signature_valid` is on the wide event + the metric

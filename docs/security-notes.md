# Security notes

Living document of security-relevant choices in this repo. Pairs with
`.cursor/skills/api-security/SKILL.md` (Motia API) and
`.cursor/rules/api-security.mdc` (the short rule).

## Boundaries

- **Motia API** (`apps/api`) is the production security boundary. Every
  public endpoint — including the call-completed webhook — is rate-limited
  and API-key authenticated via `x-api-key`. The webhook additionally
  accepts an optional `x-webhook-signature` HMAC header that is recorded
  as telemetry (`signature_state=valid|invalid|absent`) but does not gate
  the response, because HappyRobot's workflow webhook UI can only send
  static headers. See `.cursor/skills/api-security/SKILL.md`.
- **Convex** (`packages/convex`) is treated as an **open data plane** for
  this demo — see below.
- **Dashboard** (`apps/dashboard`) is a Vite SPA with no user auth; it
  reads from Convex using the public `VITE_CONVEX_URL`.

## Accepted risk: Convex is world-callable

As of the security audit on 2026-04-16, no function in
`packages/convex/convex/*.ts` performs `ctx.auth.getUserIdentity()` and
`auth.config.ts` is not configured. Anyone who obtains the
`VITE_CONVEX_URL` (which ships in the dashboard bundle at build time)
can call any query or mutation the same way the official Convex client
does.

**Exposed functions** (as of this note):

- Queries: `loads.getAll`, `loads.getByStatus`, `loads.getByLoadId`,
  `loads.search`, `calls.getRecent`, `calls.getByCallId`,
  `calls.getByOutcome`, `calls.getByCarrier`, `calls.getAll`,
  `carriers.getAll`, `carriers.getByMcNumber`, `carriers.getEligible`,
  `negotiations.getByCallId`, `negotiations.getCurrentRound`,
  `negotiations.getAll`, `metrics.getLatest`, `metrics.getHistory`,
  `metrics.getSummary`.
- Mutations: `loads.upsert`, `loads.updateStatus`, `calls.create`,
  `calls.updateOutcome`, `carriers.upsert`, `negotiations.logRound`,
  `metrics.write`.

**Privacy impact**: `calls.transcript` and `carriers.phone` are
reachable to anyone with the URL.

**Why accepted**: this repo is a take-home / practice project. The
deployment URL is not public-indexed and the dataset is synthetic.

**Mitigations in place**:

- Every function declares explicit `v.*` validators; malformed input is
  rejected at the Convex boundary.
- Reads reachable from the dashboard are bounded with `.take(LIMIT)`
  (see `packages/convex/convex/loads.ts` `MAX_ROWS = 1000` and
  `metrics.ts` `SUMMARY_SAMPLE = 5000`). This is a DoS/cost guard, not
  an authorization control.
- No secrets are stored in Convex tables.

**Escalation path** (if this repo ever leaves demo status):

1. Add `packages/convex/convex/auth.config.ts` with a JWT provider
   (Clerk / WorkOS / custom).
2. Gate every `query` and `mutation` with `ctx.auth.getUserIdentity()`
   and throw on `null`.
3. Convert all mutations (`loads.upsert`, `loads.updateStatus`,
   `calls.create`, `calls.updateOutcome`, `carriers.upsert`,
   `negotiations.logRound`, `metrics.write`) to `internalMutation` and
   call them from Motia only, via an admin-scoped `CONVEX_DEPLOY_KEY`.
4. Add a login flow to `apps/dashboard` and switch `ConvexReactClient`
   to `ConvexProviderWithAuth`.

## Middleware stack (as-is)

Every HTTP step in `apps/api/src/steps/**` mounts:

```ts
middleware: [securityHeaders, rateLimiter, apiKeyAuth, wideEventMiddleware]
```

Webhook steps skip `rateLimiter` so a legitimate batch burst from
HappyRobot cannot 429; `x-api-key` is still enforced via the global
`apiKeyAuth` plugin. The public health endpoint (`/api/v1/health`) skips
`apiKeyAuth` via path bypass; the bypass is path-based only, never
header-based.

`securityHeaders` sets `X-Content-Type-Options`, `X-Frame-Options`,
`Referrer-Policy`, and `Strict-Transport-Security` on every response,
including 401/429. CSP is intentionally not set — the API returns JSON
only.

## Known caveats

- **Webhook signature is telemetry, not auth**: `x-api-key` is the only
  gate on `/api/v1/webhooks/call-completed`. When `x-webhook-signature`
  is present the route HMACs the raw body with `WEBHOOK_SECRET` and
  records the outcome (`signature_state=valid|invalid`); when absent,
  it records `signature_state=absent`. None of these short-circuit the
  response. `WEBHOOK_SECRET` is optional and defaults to empty; with
  an empty secret the verifier always returns `false` so "valid" never
  leaks through.
- **Rate limiter state**: in-process `Map` keyed by `x-api-key`. Each
  worker has its own budget. Move to Redis if horizontal scaling
  becomes a real need (Redis is already in the stack).
- **`x-debug` header**: gated by `DEBUG_HEADER_ENABLED` (default
  `false`). Enable only in dev. See
  `apps/api/src/middleware/wide-event.middleware.ts`.
- **SigNoz JWT secret**: `SIGNOZ_JWT_SECRET` is required at compose-up;
  the stack refuses to boot without it. Generate via
  `openssl rand -base64 32` and set in Dokploy's Env tab.

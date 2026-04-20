// Pure helpers for validating `call_id` and related bridge-API ids.
// Kept dependency-free so the negotiation test suite can import the
// predicates without pulling in `config.ts` (which requires secrets
// to be present at import time).

// Convex auto-generated document ids are 32 lowercase-alphanumeric
// chars (e.g. `jd7day0t03gks4kasqj0vzkyy5852bbt`). A real HappyRobot
// session id is an RFC 4122 UUID with hyphens, so a `call_id` matching
// this pattern almost certainly came from a workflow that templated a
// row `_id` -- typically the row returned by
// `GET /api/v1/loads/:load_id` -- instead of `@session_id`.
export const CONVEX_ID_PATTERN = /^[a-z0-9]{32}$/

// The canonical header name HappyRobot workflows use to carry the
// session UUID. HR templates header values before the LLM fills the
// body, so anything in this header is guaranteed to be the workflow's
// real session id (or empty). The server keeps the check lowercase
// because Node normalizes request headers to lowercase.
export const HR_SESSION_HEADER = 'x-happyrobot-session-id'

// A value that still contains template syntax (`@session_id`,
// `{{session_id}}`, `:call_id`) means the caller shipped the raw
// template text instead of a substituted value. In HappyRobot this
// usually means the referenced variable does not exist in workflow
// scope. Used symmetrically in `find-load.ts` (loads id) and
// `log-offer.ts` (call id) so one bug surfaces the same way across
// every bridge endpoint.
export function isUnresolvedTemplate(s: string): boolean {
  return /^[@{:]/.test(s) || /[@{}]/.test(s)
}

export type CallIdSource = 'header' | 'body' | 'none'

export interface ResolvedCallId {
  /** Final id to use, or `null` when nothing usable was provided. */
  call_id: string | null
  /** Which input won the resolution race. */
  source: CallIdSource
  /** True when the body `call_id` looked like raw HR template text. */
  body_is_template: boolean
  /** True when the body `call_id` matched the 32-char Convex id pattern. */
  body_is_convex_id: boolean
}

/**
 * Canonical call_id resolution for bridge routes.
 *
 * Preference order:
 *   1. The `X-Happyrobot-Session-Id` request header -- HR templates header
 *      values server-side before the LLM runs, so this is the only input
 *      the LLM can't corrupt.
 *   2. The request body `call_id` -- only trusted when it passes both
 *      guards (not raw template text, not a Convex document id).
 *
 * The diagnostic booleans (`body_is_template`, `body_is_convex_id`) are
 * always reported against whatever body value came in, so SigNoz still
 * counts misconfig attempts even when the header path wins.
 */
export function resolveCallId(
  headerValue: string | string[] | undefined,
  bodyValue: string | undefined,
): ResolvedCallId {
  const header = typeof headerValue === 'string' ? headerValue.trim() : undefined
  const body = typeof bodyValue === 'string' ? bodyValue.trim() : undefined

  const body_is_template = body !== undefined && body.length > 0 && isUnresolvedTemplate(body)
  const body_is_convex_id = body !== undefined && body.length > 0 && CONVEX_ID_PATTERN.test(body)

  if (header && header.length > 0 && !isUnresolvedTemplate(header)) {
    return { call_id: header, source: 'header', body_is_template, body_is_convex_id }
  }

  if (body && body.length > 0 && !body_is_template && !body_is_convex_id) {
    return { call_id: body, source: 'body', body_is_template, body_is_convex_id }
  }

  return { call_id: null, source: 'none', body_is_template, body_is_convex_id }
}

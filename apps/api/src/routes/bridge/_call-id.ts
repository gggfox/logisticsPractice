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

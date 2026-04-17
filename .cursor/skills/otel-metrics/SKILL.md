---
name: otel-metrics
description: Author and modify OpenTelemetry metrics in apps/api with low-cardinality attributes, canonical names, and the right histogram/counter split. Use when adding a new counter or histogram, editing apps/api/src/observability/metrics.ts, wiring a metric call inside a Motia step, or debugging a blown-up metrics bill / cardinality explosion in SigNoz.
---

# OTel metrics

Metrics are for **aggregates** ("how many", "how long", "what fraction"),
not for individual events. Every metric attribute becomes part of the
time-series key; putting a high-cardinality value there (like `call_id`)
creates one time series per value, which blows up ClickHouse storage
and ruins dashboards.

Quick reference: `.cursor/rules/otel-metrics.mdc`. Metrics live in
[metrics.ts](../../../apps/api/src/observability/metrics.ts). Pair
with `.cursor/rules/wide-event-logging.mdc`.

## The golden rule

> If a field can take more than ~20 distinct values across the
> lifetime of the service, it does **not** belong on a metric
> attribute. Put it on the wide event instead.

Individual business details (`call_id`, `load_id`, `mc_number`, raw
rate, city name) go on the wide event, not the metric. The metric
counts *categories*.

## Naming

Format: `carrier_sales.<domain>.<event>`, snake_case, singular noun.

| Name | Kind | Unit | What |
| --- | --- | --- | --- |
| `carrier_sales.negotiation.rounds` | histogram | `rounds` | Rounds taken until accept/max/decline |
| `carrier_sales.booking.outcome` | counter | -- | Offer outcomes tagged by `result` |
| `carrier_sales.carrier.verification` | counter | -- | FMCSA verifications tagged by `eligible` |
| `carrier_sales.webhook.received` | counter | -- | Inbound webhooks tagged by `signature_valid` / `status` |
| `carrier_sales.sentiment` | counter | -- | Sentiments from transcript classification |
| `carrier_sales.call.outcome` | counter | -- | Call outcomes from transcript classification |
| `carrier_sales.load.search.results` | histogram | `loads` | Loads returned per search |

When adding a metric, follow this list's style: a concrete verb/noun
pair under the right domain. Avoid generic names (`carrier_sales.events`,
`carrier_sales.count`).

### Declaration

```ts
export const myFeatureOutcomeCounter = meter.createCounter(
  'carrier_sales.my_feature.outcome',
  { description: 'What the metric counts (one sentence)' },
)

export const myFeatureLatencyHistogram = meter.createHistogram(
  'carrier_sales.my_feature.latency',
  { description: 'Time spent doing X', unit: 'ms' },
)
```

- `description` is **required**; it shows up in SigNoz.
- Histograms declare `unit`; counters don't.
- Do not prefix names with the service (`carrier-sales-api.*`);
  OTel's resource attributes already carry that.

## Attribute keys -- closed list

Only these keys may appear on metric attributes today. Treat this as
authoritative:

```
outcome          -- overall disposition of a process ('success' | 'error' | 'rejected')
result           -- offer-specific ('accepted' | 'countered' | 'max_reached' | 'declined')
sentiment        -- from SENTIMENTS enum
round            -- negotiation round, String(n), 1..MAX_NEGOTIATION_ROUNDS
signature_valid  -- 'true' | 'false'
status           -- call / webhook status from the shared enums
eligible         -- 'true' | 'false'
```

Adding a new key is a design decision. Check first:

1. Is the value LOW cardinality (< 20 distinct values forever)?
2. Will anyone query by it on a dashboard? (If no, it belongs on the
   wide event, not the metric.)
3. Does it duplicate an existing key's purpose? (`outcome` vs `result`
   are already close -- don't add `status_code` if `outcome` captures
   it.)

## Attribute values -- LOW cardinality only

Allowed types for values:

- `'true'` / `'false'` (strings, not booleans -- OTel's string coercion
  is consistent; bool/string round-trips can diverge across exporters).
- Enum member from `packages/shared/src/constants` (`CALL_OUTCOMES`,
  `SENTIMENTS`, `LOAD_STATUSES`, `EQUIPMENT_TYPES`).
- `String(n)` where `n` is a small bounded integer (e.g. rounds 1..3).

Never:

- Identifiers: `call_id`, `load_id`, `mc_number`, `dot_number`,
  `user_id`, `api_key_hash`.
- Raw numbers as strings: `String(2400)` for a rate -- use bucketing
  ("low" / "mid" / "high") only if you genuinely need this, else put
  it on the wide event / histogram.
- Free-form user input: search queries, notes, error messages.
- Timestamps or dates.

## Histograms: what they're for

Histograms are for **distributions**. Record the observation directly,
not a tagged counter:

```ts
// GOOD -- one histogram record per negotiation.
negotiationRoundsHistogram.record(round)

// GOOD -- one record per search.
loadSearchResultsHistogram.record(results.length)
```

Good candidates:

- Latencies (iii already emits `http.server.duration`; only add custom
  if you're measuring a sub-phase).
- Counts-per-event: rounds, loads returned, transcripts length.

Not histograms:

- Monetary sums. Use Convex `metrics` + `aggregate-metrics.step.ts`
  for revenue / booking totals; OTel is for ops, Convex is for business.
- Unique counts ("distinct carriers today"). OTel can't do `count
  distinct`; aggregate in Convex.

## Counting rules

One `.add(1)` per outcome branch:

```ts
if (accepted) {
  bookingOutcomeCounter.add(1, { result: 'accepted', round: String(round) })
  return accepted()
}
if (round >= MAX_NEGOTIATION_ROUNDS) {
  bookingOutcomeCounter.add(1, { result: 'max_reached', round: String(round) })
  return maxReached()
}
bookingOutcomeCounter.add(1, { result: 'countered', round: String(round) })
return counter()
```

Do **not** put `.add(1)` in a `finally` that also runs after a success
branch already added -- you'll double-count. If you need "every
invocation", use a separate total counter.

## Sequence with the wide event

For a typical step:

```ts
enrichWideEvent(ctx, { call_id, load_id, offered_rate, round })  // high-cardinality detail
bookingOutcomeCounter.add(1, { result: 'accepted', round: String(round) })  // low-cardinality tag
```

The wide event and the metric answer different questions:

- "Why did *this call* get rejected?" -- wide event (search by `call_id`).
- "What fraction of offers get accepted at round 2?" -- metric
  (`booking.outcome{result='accepted',round='2'} / total`).

## Reviewing a change

Before merging a metric change:

- [ ] Name is `carrier_sales.<domain>.<event>`, snake_case
- [ ] `description` present; `unit` present on histograms only
- [ ] Every attribute key is in the allowed list (or you're explicitly
      adding one and have justified it)
- [ ] Every attribute value is a string from a closed set
- [ ] No identifiers / raw numbers / free text in attributes
- [ ] One `.add(1)` per branch; no double-counting from `finally`
- [ ] High-cardinality details are enriched on the wide event instead

## Debugging cardinality in SigNoz

If a metric has surprisingly high series count:

1. Open the metric in SigNoz -> Metrics Explorer.
2. Group by each attribute; the one with the largest "distinct values"
   is the offender.
3. Either remove that attribute (if you don't query by it) or replace
   the raw value with a bucket / enum.
4. Old series don't clean up automatically; retention will age them
   out in 30 days (configurable in SigNoz Settings -> General).

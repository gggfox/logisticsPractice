import { metrics } from '@opentelemetry/api'

/**
 * Custom business metrics emitted alongside the built-in iii OTel metrics
 * (http.server.*, queue.*, state.*). Exported to SigNoz via OTLP.
 *
 * Convention: use dot.notation names prefixed with `carrier_sales.`. Labels
 * (attributes) should be LOW-cardinality -- for high-cardinality fields
 * (`call_id`, `mc_number`, `load_id`), enrich the wide event instead.
 */
const meter = metrics.getMeter('carrier-sales', '1.0.0')

export const negotiationRoundsHistogram = meter.createHistogram(
  'carrier_sales.negotiation.rounds',
  {
    description: 'Number of rounds taken in a negotiation until accept/max/decline',
    unit: 'rounds',
  },
)

export const bookingOutcomeCounter = meter.createCounter('carrier_sales.booking.outcome', {
  description: 'Offer processing outcomes (accepted / countered / max_reached)',
})

export const carrierVerificationCounter = meter.createCounter(
  'carrier_sales.carrier.verification',
  { description: 'Carrier verifications performed via FMCSA, tagged by eligibility' },
)

export const webhookReceivedCounter = meter.createCounter('carrier_sales.webhook.received', {
  description:
    'Inbound call-completed webhooks received, tagged by signature presence/validity (valid|invalid|absent)',
})

export const sentimentCounter = meter.createCounter('carrier_sales.sentiment', {
  description: 'Sentiment classifications from call transcripts',
})

export const callOutcomeCounter = meter.createCounter('carrier_sales.call.outcome', {
  description: 'Call outcomes classified from transcripts',
})

export const loadSearchResultsHistogram = meter.createHistogram(
  'carrier_sales.load.search.results',
  {
    description: 'Number of loads returned by a search query',
    unit: 'loads',
  },
)

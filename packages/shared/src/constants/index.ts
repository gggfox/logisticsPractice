export const EQUIPMENT_TYPES = [
  'dry_van',
  'reefer',
  'flatbed',
  'step_deck',
  'power_only',
  'box_truck',
  'hotshot',
] as const

export type EquipmentType = (typeof EQUIPMENT_TYPES)[number]

export const CALL_OUTCOMES = ['booked', 'declined', 'no_match', 'transferred', 'dropped'] as const

export type CallOutcome = (typeof CALL_OUTCOMES)[number]

export const SENTIMENTS = ['positive', 'neutral', 'negative', 'frustrated'] as const

export type Sentiment = (typeof SENTIMENTS)[number]

export const LOAD_STATUSES = ['available', 'in_negotiation', 'booked', 'expired'] as const

export type LoadStatus = (typeof LOAD_STATUSES)[number]

export const MAX_NEGOTIATION_ROUNDS = 3

export const OFFER_ACCEPT_MARGIN_PERCENT = 5

export const CARRIER_CACHE_TTL_MS = 24 * 60 * 60 * 1000

export const RATE_LIMIT = {
  windowMs: 60_000,
  maxRequests: 100,
} as const

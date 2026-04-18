import {
  CARRIER_CACHE_TTL_MS,
  type CarrierVerificationResponse,
  FMCSACarrierResponseSchema,
} from '@carrier-sales/shared'
import { config } from '../config.js'
import { convexService } from './convex.service.js'

const FMCSA_BASE_URL = 'https://mobile.fmcsa.dot.gov/qc/services/carriers'

/**
 * FMCSA returns HTTP 200 with `{ content: null }` for DOT/MC numbers it
 * doesn't recognize (including non-numeric input and MC-docket-prefixed
 * strings). Treat that shape as a "not found" signal so callers can
 * distinguish it from a real schema mismatch.
 */
export function isFmcsaNotFound(data: unknown): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    'content' in data &&
    (data as { content: unknown }).content === null
  )
}

/**
 * FMCSA returns HTTP 500 with a stringified "We encountered an error ... Error ID: ..."
 * inside `content` when it can't parse the identifier. This is a client-input error
 * dressed up as a 5xx. Treat it as NOT_FOUND, not a retriable upstream outage.
 */
export function isFmcsaInvalidIdError(data: unknown): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    'content' in data &&
    typeof (data as { content: unknown }).content === 'string' &&
    /Error ID:/i.test((data as { content: string }).content)
  )
}

/**
 * Strip voice-agent prefixes (`MC-`, `DOT-`, optional space) from a raw
 * carrier identifier and confirm the remainder is numeric. The FMCSA
 * QCMobile `carriers/{id}` endpoint only accepts digits -- anything else
 * should be short-circuited to NOT_FOUND before we spend a network call.
 */
export function normalizeCarrierId(
  raw: string,
): { kind: 'digits'; digits: string } | { kind: 'invalid'; reason: string } {
  const trimmed = raw.trim().toUpperCase()
  const stripped = trimmed
    .replace(/^MC[-\s]?/, '')
    .replace(/^DOT[-\s]?/, '')
    .trim()
  if (stripped.length === 0) {
    return { kind: 'invalid', reason: 'Empty identifier' }
  }
  if (!/^\d+$/.test(stripped)) {
    return { kind: 'invalid', reason: `Non-numeric carrier identifier: ${raw}` }
  }
  return { kind: 'digits', digits: stripped }
}

async function handleFmcsaErrorResponse(response: Response): Promise<null> {
  try {
    const data = await response.json()
    if (isFmcsaInvalidIdError(data)) {
      return null
    }
  } catch {
    // body unreadable or already consumed; fall through to throw
  }
  throw new Error(`FMCSA API returned ${response.status}: ${response.statusText}`)
}

async function fetchFromFMCSAOnce(url: string) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  })

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    return handleFmcsaErrorResponse(response)
  }

  const data = await response.json()

  if (isFmcsaNotFound(data)) {
    return null
  }

  return FMCSACarrierResponseSchema.parse(data)
}

async function fetchFromFMCSA(mcNumber: string) {
  const url = `${FMCSA_BASE_URL}/${mcNumber}?webKey=${config.fmcsa.webKey}`

  let lastError: Error | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fetchFromFMCSAOnce(url)
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)))
      }
    }
  }

  throw lastError ?? new Error('FMCSA API request failed after 3 retries')
}

function evaluateEligibility(carrier: {
  allowedToOperate: string
  statusCode: string
  oosDate?: string
}): { eligible: boolean; reason?: string } {
  if (carrier.allowedToOperate !== 'Y') {
    return { eligible: false, reason: 'Carrier is not authorized to operate' }
  }
  if (carrier.statusCode === 'X') {
    return { eligible: false, reason: 'Carrier has out-of-service order' }
  }
  if (carrier.oosDate) {
    const oosDate = new Date(carrier.oosDate)
    if (oosDate.getTime() > Date.now()) {
      return { eligible: false, reason: `Carrier has active OOS order until ${carrier.oosDate}` }
    }
  }
  return { eligible: true }
}

export async function verifyCarrier(mcNumber: string): Promise<CarrierVerificationResponse> {
  const cached = await convexService.carriers.getByMcNumber(mcNumber)

  if (cached) {
    const cacheAge = Date.now() - new Date(cached.verified_at).getTime()
    if (cacheAge < CARRIER_CACHE_TTL_MS) {
      return {
        mc_number: cached.mc_number,
        legal_name: cached.legal_name,
        is_eligible: cached.is_eligible,
        operating_status: cached.operating_status,
      }
    }
  }

  const fmcsaData = await fetchFromFMCSA(mcNumber)

  if (!fmcsaData) {
    return {
      mc_number: mcNumber,
      legal_name: 'Unknown',
      is_eligible: false,
      operating_status: 'NOT_FOUND',
      reason: 'Carrier not found in FMCSA database',
    }
  }

  const carrier = fmcsaData.content.carrier
  const { eligible, reason } = evaluateEligibility(carrier)

  const carrierRecord = {
    mc_number: mcNumber,
    legal_name: carrier.legalName,
    dot_number: carrier.dotNumber,
    operating_status: carrier.allowedToOperate === 'Y' ? 'AUTHORIZED' : 'NOT_AUTHORIZED',
    safety_rating: carrier.safetyRating,
    is_eligible: eligible,
    verified_at: new Date().toISOString(),
    phone: carrier.phone,
    total_drivers: carrier.totalDrivers,
    total_power_units: carrier.totalPowerUnits,
  }

  await convexService.carriers.upsert(carrierRecord)

  return {
    mc_number: mcNumber,
    legal_name: carrier.legalName,
    is_eligible: eligible,
    operating_status: carrierRecord.operating_status,
    reason,
  }
}

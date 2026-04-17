import {
  CARRIER_CACHE_TTL_MS,
  type CarrierVerificationResponse,
  FMCSACarrierResponseSchema,
} from '@carrier-sales/shared'
import { convexService } from './convex.service.js'

const FMCSA_BASE_URL = 'https://mobile.fmcsa.dot.gov/qc/services/carriers'

function getFmcsaWebKey(): string {
  const key = process.env.FMCSA_WEB_KEY
  if (!key) throw new Error('FMCSA_WEB_KEY environment variable is required')
  return key
}

async function fetchFromFMCSA(mcNumber: string) {
  const url = `${FMCSA_BASE_URL}/${mcNumber}?webKey=${getFmcsaWebKey()}`

  let lastError: Error | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      })

      if (response.status === 404) {
        return null
      }

      if (!response.ok) {
        throw new Error(`FMCSA API returned ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      return FMCSACarrierResponseSchema.parse(data)
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

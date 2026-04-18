import type { FastifyPluginAsync } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { config } from '../../config.js'
import { enrichWideEvent } from '../../observability/wide-event-store.js'
import { convexService } from '../../services/convex.service.js'
import { ErrorBodySchema } from '../_error-schema.js'

const BodySchema = z
  .object({
    count: z.number().int().positive().default(50),
  })
  .optional()

const ResponseSchema = z.object({
  seeded: z.number().int().nonnegative(),
})

type Load = {
  load_id: string
  origin: string
  destination: string
  pickup_datetime: string
  delivery_datetime: string
  equipment_type: string
  loadboard_rate: number
  notes: string
  weight: number
  commodity_type: string
  num_of_pieces: number
  miles: number
  dimensions: string
  status: string
}

function generateSampleLoads(): Load[] {
  const lanes = [
    { origin: 'Dallas, TX', destination: 'Chicago, IL', miles: 920 },
    { origin: 'Los Angeles, CA', destination: 'Phoenix, AZ', miles: 370 },
    { origin: 'Atlanta, GA', destination: 'Miami, FL', miles: 660 },
    { origin: 'Houston, TX', destination: 'Memphis, TN', miles: 580 },
    { origin: 'Chicago, IL', destination: 'Detroit, MI', miles: 280 },
  ]

  const equipment = ['dry_van', 'reefer', 'flatbed'] as const
  const commodities = ['General Freight', 'Refrigerated Food', 'Building Materials', 'Electronics']

  return lanes.map((lane, i) => {
    const pickup = new Date()
    pickup.setDate(pickup.getDate() + i + 1)
    const delivery = new Date(pickup)
    delivery.setDate(delivery.getDate() + 2)

    const equipmentType = equipment[i % equipment.length] ?? 'dry_van'
    const commodity = commodities[i % commodities.length] ?? 'General Freight'

    return {
      load_id: `LOAD-${String(1000 + i).padStart(4, '0')}`,
      origin: lane.origin,
      destination: lane.destination,
      pickup_datetime: pickup.toISOString(),
      delivery_datetime: delivery.toISOString(),
      equipment_type: equipmentType,
      loadboard_rate: Math.round(lane.miles * (2.5 + Math.random())),
      notes: '',
      weight: Math.round(20000 + Math.random() * 25000),
      commodity_type: commodity,
      num_of_pieces: Math.round(1 + Math.random() * 30),
      miles: lane.miles,
      dimensions: '53ft',
      status: 'available',
    }
  })
}

function headerString(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  return undefined
}

const seedLoadsRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/api/v1/admin/seed',
    {
      schema: {
        tags: ['admin'],
        summary: 'Seed demo loads into Convex',
        description:
          'Idempotently upserts a deterministic set of sample loads for demos and E2E tests. Requires the admin key -- the bridge key is rejected with 403.',
        body: BodySchema,
        response: {
          200: ResponseSchema,
          403: ErrorBodySchema,
        },
      },
    },
    async (req, reply) => {
      const apiKey = headerString(req.headers['x-api-key'])
      const adminAuthOk = apiKey === config.bridge.adminKey
      enrichWideEvent(req, { admin_auth_ok: adminAuthOk })

      if (!adminAuthOk) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'Admin access required',
          statusCode: 403,
        })
      }

      const sampleLoads = generateSampleLoads()
      for (const load of sampleLoads) {
        await convexService.loads.upsert(load)
      }

      enrichWideEvent(req, { seeded_count: sampleLoads.length })
      return { seeded: sampleLoads.length }
    },
  )
}

export default seedLoadsRoute

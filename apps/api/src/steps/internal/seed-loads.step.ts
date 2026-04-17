import { type Handlers, type StepConfig, api } from 'motia'
import { z } from 'zod'
import { config as appConfig } from '../../config.js'
import { wideEventMiddleware } from '../../middleware/wide-event.middleware.js'
import { enrichWideEvent } from '../../observability/wide-event-store.js'
import { convexService } from '../../services/convex.service.js'

export const config = {
  name: 'SeedLoads',
  description: 'Seed database with demo load data (admin only)',
  triggers: [
    api('POST', '/api/v1/admin/seed', {
      bodySchema: z.object({ count: z.number().int().positive().default(50) }).optional(),
      middleware: [wideEventMiddleware],
    }),
  ],
  flows: ['internal-api'],
} as const satisfies StepConfig

export const handler: Handlers<typeof config> = async (req, ctx) => {
  const adminKey = appConfig.bridge.adminKey
  const apiKey = req.headers['x-api-key']
  const adminAuthOk = apiKey === adminKey

  enrichWideEvent(ctx, { admin_auth_ok: adminAuthOk })

  if (!adminAuthOk) {
    return {
      status: 403,
      body: {
        error: 'Forbidden',
        message: 'Admin access required',
        statusCode: 403,
      },
    }
  }

  const sampleLoads = generateSampleLoads()

  for (const load of sampleLoads) {
    await convexService.loads.upsert(load)
  }

  enrichWideEvent(ctx, { seeded_count: sampleLoads.length })

  return { status: 200, body: { seeded: sampleLoads.length } }
}

function generateSampleLoads() {
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

    return {
      load_id: `LOAD-${String(1000 + i).padStart(4, '0')}`,
      origin: lane.origin,
      destination: lane.destination,
      pickup_datetime: pickup.toISOString(),
      delivery_datetime: delivery.toISOString(),
      equipment_type: equipment[i % equipment.length] as (typeof equipment)[number],
      loadboard_rate: Math.round(lane.miles * (2.5 + Math.random())),
      notes: '',
      weight: Math.round(20000 + Math.random() * 25000),
      commodity_type: commodities[i % commodities.length] as string,
      num_of_pieces: Math.round(1 + Math.random() * 30),
      miles: lane.miles,
      dimensions: '53ft',
      status: 'available',
    }
  })
}

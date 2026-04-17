import { http, type Handlers, type StepConfig } from 'motia'
import { z } from 'zod'
import { convexService } from '../../services/convex.service.js'

export const config = {
  name: 'SeedLoads',
  description: 'Seed database with demo load data (admin only)',
  triggers: [
    http('POST', '/api/v1/admin/seed', {
      bodySchema: z.object({ count: z.number().int().positive().default(50) }).optional(),
    }),
  ],
  flows: ['internal-api'],
} as const satisfies StepConfig

export const handler: Handlers<typeof config> = {
  async api(req, res, { logger }) {
    const adminKey = process.env.ADMIN_API_KEY
    const apiKey = req.headers['x-api-key']

    if (!adminKey || apiKey !== adminKey) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Admin access required',
        statusCode: 403,
      })
    }

    logger.info('Seeding load data')

    // Seed is handled by the scripts/seed.ts file
    // This endpoint triggers a simplified inline seed for quick demos
    const sampleLoads = generateSampleLoads()

    for (const load of sampleLoads) {
      await convexService.loads.upsert(load)
    }

    logger.info('Seed complete', { count: sampleLoads.length })
    return res.status(200).json({ seeded: sampleLoads.length })
  },
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

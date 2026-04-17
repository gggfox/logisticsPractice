/**
 * Seed script: generates 50+ realistic US freight loads and sample carrier/call records.
 *
 * Usage:
 *   npx tsx scripts/seed.ts
 *
 * Requires CONVEX_URL in .env or as an environment variable.
 */
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../packages/convex/convex/_generated/api'

const CONVEX_URL = process.env.CONVEX_URL
if (!CONVEX_URL) {
  console.error('Set CONVEX_URL in your environment or .env file')
  process.exit(1)
}

const client = new ConvexHttpClient(CONVEX_URL)

const LANES: { origin: string; destination: string; miles: number }[] = [
  { origin: 'Dallas, TX', destination: 'Chicago, IL', miles: 920 },
  { origin: 'Los Angeles, CA', destination: 'Phoenix, AZ', miles: 370 },
  { origin: 'Atlanta, GA', destination: 'Miami, FL', miles: 660 },
  { origin: 'Houston, TX', destination: 'Memphis, TN', miles: 580 },
  { origin: 'Chicago, IL', destination: 'Detroit, MI', miles: 280 },
  { origin: 'Dallas, TX', destination: 'Atlanta, GA', miles: 780 },
  { origin: 'Los Angeles, CA', destination: 'Seattle, WA', miles: 1135 },
  { origin: 'Miami, FL', destination: 'Charlotte, NC', miles: 650 },
  { origin: 'Houston, TX', destination: 'Dallas, TX', miles: 240 },
  { origin: 'Denver, CO', destination: 'Kansas City, MO', miles: 600 },
  { origin: 'Nashville, TN', destination: 'Indianapolis, IN', miles: 290 },
  { origin: 'Phoenix, AZ', destination: 'El Paso, TX', miles: 430 },
  { origin: 'Memphis, TN', destination: 'St. Louis, MO', miles: 285 },
  { origin: 'Columbus, OH', destination: 'Charlotte, NC', miles: 450 },
  { origin: 'Jacksonville, FL', destination: 'Atlanta, GA', miles: 345 },
  { origin: 'San Antonio, TX', destination: 'Laredo, TX', miles: 155 },
  { origin: 'Minneapolis, MN', destination: 'Chicago, IL', miles: 410 },
  { origin: 'Oklahoma City, OK', destination: 'Dallas, TX', miles: 205 },
  { origin: 'Salt Lake City, UT', destination: 'Denver, CO', miles: 525 },
  { origin: 'Portland, OR', destination: 'Los Angeles, CA', miles: 965 },
  { origin: 'Detroit, MI', destination: 'Columbus, OH', miles: 200 },
  { origin: 'Kansas City, MO', destination: 'Memphis, TN', miles: 450 },
  { origin: 'Charlotte, NC', destination: 'Jacksonville, FL', miles: 395 },
  { origin: 'Seattle, WA', destination: 'Portland, OR', miles: 175 },
  { origin: 'New York, NY', destination: 'Charlotte, NC', miles: 635 },
]

const EQUIPMENT = ['dry_van', 'reefer', 'flatbed', 'step_deck', 'power_only'] as const
const COMMODITIES = [
  'General Freight',
  'Refrigerated Food',
  'Building Materials',
  'Electronics',
  'Automotive Parts',
  'Paper Products',
  'Beverages',
  'Household Goods',
  'Machinery',
  'Agricultural Products',
]

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function rateForLane(miles: number, equipment: string): number {
  const perMile = equipment === 'reefer' ? 3.2 : equipment === 'flatbed' ? 2.9 : 2.5
  const variance = 0.85 + Math.random() * 0.3
  return Math.round(miles * perMile * variance)
}

async function seedLoads() {
  console.log('Seeding loads...')
  const loads = []

  for (let i = 0; i < 55; i++) {
    const lane = LANES[i % LANES.length] as (typeof LANES)[number]
    const equip = EQUIPMENT[i % EQUIPMENT.length] as (typeof EQUIPMENT)[number]
    const commodity = COMMODITIES[i % COMMODITIES.length] as (typeof COMMODITIES)[number]

    const pickup = new Date()
    pickup.setDate(pickup.getDate() + rand(1, 14))
    pickup.setHours(rand(6, 18), 0, 0, 0)

    const delivery = new Date(pickup)
    delivery.setDate(delivery.getDate() + rand(1, 3))

    const load = {
      load_id: `LD-${String(2000 + i).padStart(5, '0')}`,
      origin: lane.origin,
      destination: lane.destination,
      pickup_datetime: pickup.toISOString(),
      delivery_datetime: delivery.toISOString(),
      equipment_type: equip,
      loadboard_rate: rateForLane(lane.miles, equip),
      notes: i % 5 === 0 ? 'Driver assist required at delivery' : '',
      weight: rand(15000, 45000),
      commodity_type: commodity,
      num_of_pieces: rand(1, 40),
      miles: lane.miles,
      dimensions: equip === 'flatbed' ? '48ft' : '53ft',
      status: i < 45 ? 'available' : i < 50 ? 'in_negotiation' : 'booked',
    }

    loads.push(load)
    await client.mutation(api.loads.upsert, load)
  }

  console.log(`  Seeded ${loads.length} loads`)
  return loads
}

async function seedCarriers() {
  console.log('Seeding carriers...')
  const carriers = [
    { mc: '100001', name: 'Swift Transport LLC', dot: '500001', eligible: true },
    { mc: '100002', name: 'Heartland Express Inc', dot: '500002', eligible: true },
    { mc: '100003', name: 'Werner Enterprises', dot: '500003', eligible: true },
    { mc: '100004', name: 'Old Dominion Freight', dot: '500004', eligible: true },
    { mc: '100005', name: 'Knight Transportation', dot: '500005', eligible: true },
    { mc: '100006', name: 'USA Truck Inc', dot: '500006', eligible: true },
    { mc: '100007', name: 'Central Freight Lines', dot: '500007', eligible: false },
    { mc: '100008', name: 'Estes Express Lines', dot: '500008', eligible: true },
    { mc: '100009', name: 'Southeastern Freight', dot: '500009', eligible: true },
    { mc: '100010', name: 'Marten Transport', dot: '500010', eligible: true },
  ]

  for (const c of carriers) {
    await client.mutation(api.carriers.upsert, {
      mc_number: c.mc,
      legal_name: c.name,
      dot_number: c.dot,
      operating_status: c.eligible ? 'AUTHORIZED' : 'NOT_AUTHORIZED',
      is_eligible: c.eligible,
      verified_at: new Date().toISOString(),
      total_drivers: rand(5, 200),
      total_power_units: rand(3, 150),
    })
  }

  console.log(`  Seeded ${carriers.length} carriers`)
  return carriers
}

async function seedCalls(carriers: { mc: string; name: string }[], loads: { load_id: string }[]) {
  console.log('Seeding calls...')
  const outcomes = ['booked', 'declined', 'no_match', 'transferred', 'dropped'] as const
  const sentiments = ['positive', 'neutral', 'negative', 'frustrated'] as const

  for (let i = 0; i < 30; i++) {
    const carrier = carriers[i % carriers.length] as (typeof carriers)[number]
    const load = loads[i % loads.length] as (typeof loads)[number]
    const started = new Date()
    started.setDate(started.getDate() - rand(0, 7))
    started.setHours(rand(8, 17), rand(0, 59))
    const ended = new Date(started)
    ended.setMinutes(ended.getMinutes() + rand(2, 12))

    const outcome = outcomes[i % outcomes.length] as (typeof outcomes)[number]
    const sentiment = sentiments[i % sentiments.length] as (typeof sentiments)[number]
    const rounds = outcome === 'booked' ? rand(1, 3) : rand(0, 2)

    await client.mutation(api.calls.create, {
      call_id: `CALL-${String(3000 + i).padStart(5, '0')}`,
      carrier_mc: carrier.mc,
      load_id: load.load_id,
      transcript: `Sample conversation transcript for call ${i + 1} with ${carrier.name}.`,
      outcome,
      sentiment,
      duration_seconds: rand(120, 720),
      negotiation_rounds: rounds,
      final_rate: outcome === 'booked' ? rand(1800, 3500) : undefined,
      started_at: started.toISOString(),
      ended_at: ended.toISOString(),
    })

    if (rounds > 0) {
      for (let r = 1; r <= rounds; r++) {
        await client.mutation(api.negotiations.logRound, {
          call_id: `CALL-${String(3000 + i).padStart(5, '0')}`,
          round: r,
          offered_rate: rand(1600, 3000),
          counter_rate: r < rounds ? rand(2000, 3200) : undefined,
          accepted: r === rounds && outcome === 'booked',
          timestamp: new Date(started.getTime() + r * 60000).toISOString(),
        })
      }
    }
  }

  console.log('  Seeded 30 calls with negotiations')
}

async function main() {
  console.log('Starting seed...\n')
  const loads = await seedLoads()
  const carriers = await seedCarriers()
  await seedCalls(carriers, loads)
  console.log('\nSeed complete!')
}

main().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})

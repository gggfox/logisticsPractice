import { KpiCard } from '@/components/KpiCard'
import { formatCurrency, formatPercent } from '@/lib/formatters'
import { api } from '@carrier-sales/convex/convex/_generated/api'
import { useQuery } from 'convex/react'
import { useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

type NegotiationDoc = {
  call_id: string
  round: number
  offered_rate: number
  counter_rate?: number
  accepted: boolean
  timestamp: string
}

type CallDoc = {
  call_id: string
  carrier_mc: string
  outcome?: string
}

function groupByCallId(rows: NegotiationDoc[]) {
  const map = new Map<string, NegotiationDoc[]>()
  for (const n of rows) {
    const list = map.get(n.call_id) ?? []
    list.push(n)
    map.set(n.call_id, list)
  }
  return map
}

function finalRoundForCall(rounds: NegotiationDoc[]): number {
  return Math.max(...rounds.map((r) => r.round))
}

type ScatterPoint = {
  offered_rate: number
  counter_rate: number
  call_id: string
  round: number
  carrier_mc: string
}

type NegotiationAnalytics = {
  totalDistinctNegotiations: number
  acceptanceRate: number
  avgRoundsToClose: number
  roundDistribution: { round: string; count: number }[]
  scatterPoints: ScatterPoint[]
}

function computeNegotiationAnalytics(
  negotiations: NegotiationDoc[],
  callById: Map<string, CallDoc>,
): NegotiationAnalytics {
  const byCall = groupByCallId(negotiations)
  const totalDistinctNegotiations = byCall.size

  const acceptedRounds = negotiations.filter((n) => n.accepted).length
  const acceptanceRate = negotiations.length > 0 ? acceptedRounds / negotiations.length : 0

  let sumClosing = 0
  let closedWithAccept = 0
  for (const rounds of byCall.values()) {
    const withAccept = rounds.filter((r) => r.accepted)
    if (withAccept.length === 0) continue
    const closingRound = Math.max(...withAccept.map((r) => r.round))
    sumClosing += closingRound
    closedWithAccept += 1
  }
  const avgRoundsToClose = closedWithAccept > 0 ? sumClosing / closedWithAccept : 0

  const dist = { 1: 0, 2: 0, 3: 0 }
  for (const rounds of byCall.values()) {
    const fr = finalRoundForCall(rounds)
    if (fr === 1) dist[1] += 1
    else if (fr === 2) dist[2] += 1
    else if (fr >= 3) dist[3] += 1
  }
  const roundDistribution = [
    { round: 'Round 1', count: dist[1] },
    { round: 'Round 2', count: dist[2] },
    { round: 'Round 3+', count: dist[3] },
  ]

  const scatterPoints: ScatterPoint[] = negotiations
    .filter((n): n is NegotiationDoc & { counter_rate: number } => n.counter_rate != null)
    .map((n) => ({
      offered_rate: n.offered_rate,
      counter_rate: n.counter_rate,
      call_id: n.call_id,
      round: n.round,
      carrier_mc: callById.get(n.call_id)?.carrier_mc ?? '—',
    }))

  return {
    totalDistinctNegotiations,
    acceptanceRate,
    avgRoundsToClose,
    roundDistribution,
    scatterPoints,
  }
}

const emptyAnalytics: NegotiationAnalytics = {
  totalDistinctNegotiations: 0,
  acceptanceRate: 0,
  avgRoundsToClose: 0,
  roundDistribution: [
    { round: 'Round 1', count: 0 },
    { round: 'Round 2', count: 0 },
    { round: 'Round 3+', count: 0 },
  ],
  scatterPoints: [],
}

function ChartSkeleton({ title }: Readonly<{ title: string }>) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
      <h2 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
      <div className="h-[320px] animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800/80" />
    </div>
  )
}

const chartTooltipStyle = {
  backgroundColor: 'rgba(17, 24, 39, 0.95)',
  border: '1px solid rgb(55, 65, 81)',
  borderRadius: '8px',
  color: '#f9fafb',
}

function scatterTooltipLabel(payload: readonly unknown[] | undefined): string {
  const first = payload?.[0]
  if (first === null || typeof first !== 'object' || !('payload' in first)) {
    return ''
  }
  const inner: unknown = 'payload' in first ? first.payload : undefined
  if (inner === null || typeof inner !== 'object') return ''
  const carrierMc =
    'carrier_mc' in inner && typeof inner.carrier_mc === 'string' ? inner.carrier_mc : '—'
  const round = 'round' in inner && typeof inner.round === 'number' ? inner.round : '?'
  return `MC ${carrierMc} · Round ${round}`
}

export function NegotiationPage() {
  const negotiations = useQuery(api.negotiations.getAll) as NegotiationDoc[] | undefined
  const calls = useQuery(api.calls.getAll) as CallDoc[] | undefined

  const loading = negotiations === undefined || calls === undefined

  const callById = useMemo(() => {
    if (!calls) return new Map<string, CallDoc>()
    return new Map(calls.map((c) => [c.call_id, c]))
  }, [calls])

  const {
    totalDistinctNegotiations,
    acceptanceRate,
    avgRoundsToClose,
    roundDistribution,
    scatterPoints,
  } = useMemo(() => {
    if (!negotiations) return emptyAnalytics
    return computeNegotiationAnalytics(negotiations, callById)
  }, [negotiations, callById])

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
          Negotiation analytics
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Round outcomes, acceptance, and rate positioning across carrier conversations.
        </p>
      </header>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-[140px] animate-pulse rounded-xl border border-gray-200 bg-gray-100 dark:border-gray-800 dark:bg-gray-800/80"
            />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <KpiCard
            title="Total Negotiations"
            value={String(totalDistinctNegotiations)}
            subtitle="Distinct calls with at least one logged round"
          />
          <KpiCard
            title="Acceptance Rate"
            value={formatPercent(acceptanceRate)}
            subtitle="Accepted rounds ÷ total rounds"
          />
          <KpiCard
            title="Avg Rounds to Close"
            value={avgRoundsToClose > 0 ? avgRoundsToClose.toFixed(1) : '—'}
            subtitle="Among calls with an accepted round"
          />
        </div>
      )}

      {loading ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <ChartSkeleton title="Negotiation round distribution" />
          <ChartSkeleton title="Offered vs counter rate by round" />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
            <h2 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">
              Negotiation round distribution
            </h2>
            <div className="h-[320px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={roundDistribution}
                  margin={{ top: 8, right: 8, bottom: 8, left: 8 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    className="stroke-gray-200 dark:stroke-gray-700"
                  />
                  <XAxis
                    dataKey="round"
                    tick={{ fill: 'currentColor', fontSize: 12 }}
                    className="text-gray-600 dark:text-gray-400"
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: 'currentColor', fontSize: 12 }}
                    className="text-gray-600 dark:text-gray-400"
                  />
                  <Tooltip
                    contentStyle={chartTooltipStyle}
                    labelStyle={{ color: '#f9fafb' }}
                    formatter={(value: number) => [value, 'Calls']}
                  />
                  <Bar dataKey="count" fill="#10b981" radius={[6, 6, 0, 0]} name="Calls" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
            <h2 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">
              Offered vs counter rate by round
            </h2>
            <div className="h-[320px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    className="stroke-gray-200 dark:stroke-gray-700"
                  />
                  <XAxis
                    type="number"
                    dataKey="offered_rate"
                    name="Offered"
                    tick={{ fill: 'currentColor', fontSize: 12 }}
                    className="text-gray-600 dark:text-gray-400"
                    tickFormatter={(v: number) => formatCurrency(v)}
                  />
                  <YAxis
                    type="number"
                    dataKey="counter_rate"
                    name="Counter"
                    tick={{ fill: 'currentColor', fontSize: 12 }}
                    className="text-gray-600 dark:text-gray-400"
                    tickFormatter={(v: number) => formatCurrency(v)}
                  />
                  <Tooltip
                    contentStyle={chartTooltipStyle}
                    formatter={(value: number, name: string) => [formatCurrency(value), name]}
                    labelFormatter={(_, payload) => scatterTooltipLabel(payload)}
                  />
                  <Scatter data={scatterPoints} fill="#34d399" />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            {scatterPoints.length === 0 && (
              <p className="mt-2 text-center text-xs text-gray-500 dark:text-gray-400">
                No rounds with a counter rate yet.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

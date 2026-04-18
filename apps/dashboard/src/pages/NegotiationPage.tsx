import { EmptyState } from '@/components/EmptyState'
import { SectionHeader } from '@/components/SectionHeader'
import { StatCard } from '@/components/StatCard'
import { PageLayout } from '@/components/layout/PageLayout'
import { formatCurrency, formatPercent } from '@/lib/formatters'
import { api } from '@carrier-sales/convex/convex/_generated/api'
import { useQuery } from 'convex/react'
import { ChartScatter, Handshake, Percent, Target } from 'lucide-react'
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

const chartTooltipStyle = {
  backgroundColor: 'rgb(15 23 42)',
  border: '1px solid rgb(51 65 85)',
  borderRadius: '10px',
  color: '#f8fafc',
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

  const hasRoundData = roundDistribution.some((r) => r.count > 0)

  return (
    <PageLayout
      eyebrow="Outcomes"
      title="Negotiation analytics"
      description="Round outcomes, acceptance, and rate positioning across carrier conversations."
    >
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-[160px] animate-pulse rounded-xl2 border border-surface-border/70 bg-surface-2"
            />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            label="Total Negotiations"
            value={String(totalDistinctNegotiations)}
            icon={Handshake}
            index={0}
          />
          <StatCard
            label="Acceptance Rate"
            value={formatPercent(acceptanceRate)}
            icon={Percent}
            index={1}
          />
          <StatCard
            label="Avg Rounds to Close"
            value={avgRoundsToClose > 0 ? avgRoundsToClose.toFixed(1) : '—'}
            icon={Target}
            index={2}
          />
        </div>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <div>
          <SectionHeader eyebrow="Closing" title="Negotiation round distribution" />
          {loading ? (
            <div className="mt-4 h-[320px] animate-pulse rounded-xl2 bg-surface-2" />
          ) : !hasRoundData ? (
            <EmptyState
              className="mt-4"
              icon={Target}
              title="No rounds logged yet"
              description="Round history will appear once negotiations begin closing."
            />
          ) : (
            <div className="mt-4 h-[320px] w-full rounded-xl2 border border-surface-border/70 bg-surface-1 p-3">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={roundDistribution}
                  margin={{ top: 8, right: 8, bottom: 8, left: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="rgb(148 163 184 / 0.2)" />
                  <XAxis
                    dataKey="round"
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    contentStyle={chartTooltipStyle}
                    labelStyle={{ color: '#e2e8f0' }}
                    itemStyle={{ color: '#e2e8f0' }}
                    formatter={(value: number) => [value, 'Calls']}
                  />
                  <Bar dataKey="count" fill="#f59e0b" radius={[6, 6, 0, 0]} name="Calls" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div>
          <SectionHeader eyebrow="Positioning" title="Offered vs counter rate by round" />
          {loading ? (
            <div className="mt-4 h-[320px] animate-pulse rounded-xl2 bg-surface-2" />
          ) : scatterPoints.length === 0 ? (
            <EmptyState
              className="mt-4"
              icon={ChartScatter}
              title="No counter rates yet"
              description="Points will appear here once carriers counter with a rate."
            />
          ) : (
            <div className="mt-4 h-[320px] w-full rounded-xl2 border border-surface-border/70 bg-surface-1 p-3">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgb(148 163 184 / 0.2)" />
                  <XAxis
                    type="number"
                    dataKey="offered_rate"
                    name="Offered"
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => formatCurrency(v)}
                  />
                  <YAxis
                    type="number"
                    dataKey="counter_rate"
                    name="Counter"
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => formatCurrency(v)}
                  />
                  <Tooltip
                    contentStyle={chartTooltipStyle}
                    formatter={(value: number, name: string) => [formatCurrency(value), name]}
                    labelFormatter={(_, payload) => scatterTooltipLabel(payload)}
                  />
                  <Scatter data={scatterPoints} fill="#10b981" />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </PageLayout>
  )
}

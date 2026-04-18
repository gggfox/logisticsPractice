import { EmptyState } from '@/components/EmptyState'
import { SectionHeader } from '@/components/SectionHeader'
import { StatCard } from '@/components/StatCard'
import { PageLayout } from '@/components/layout/PageLayout'
import { formatCurrency, formatPercent } from '@/lib/formatters'
import { api } from '@carrier-sales/convex/convex/_generated/api'
import { useQuery } from 'convex/react'
import {
  BarChart3,
  CheckCircle2,
  DollarSign,
  PhoneCall,
  PieChart as PieChartIcon,
  Repeat,
  TrendingUp,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

type MetricsSummary = {
  total_calls: number
  booking_rate: number
  revenue_booked: number
  avg_negotiation_rounds: number
  sentiment_distribution: {
    positive: number
    neutral: number
    negative: number
    frustrated: number
  }
  outcome_distribution: {
    booked: number
    declined: number
    no_match: number
    transferred: number
    dropped: number
  }
}

type MetricsHistoryRow = {
  timestamp: string
  total_calls: number
}

const OUTCOME_PIE_COLORS: Record<string, string> = {
  booked: '#10b981',
  declined: '#f43f5e',
  no_match: '#94a3b8',
  transferred: '#0ea5e9',
  dropped: '#ef4444',
}

const SENTIMENT_BAR_COLORS: Record<string, string> = {
  positive: '#10b981',
  neutral: '#94a3b8',
  negative: '#f59e0b',
  frustrated: '#f43f5e',
}

const KPI_SKELETON_KEYS = ['kpi-a', 'kpi-b', 'kpi-c', 'kpi-d'] as const

function formatChartTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
  })
}

export function OverviewPage() {
  const summary = useQuery(api.metrics.getSummary) as MetricsSummary | undefined
  const history = useQuery(api.metrics.getHistory, { limit: 24 }) as MetricsHistoryRow[] | undefined

  const lineData =
    history?.map((row) => ({
      timestamp: row.timestamp,
      total_calls: row.total_calls,
    })) ?? []

  const sparkSeries = history?.map((row) => row.total_calls) ?? []

  const pieData = summary
    ? (
        [
          { key: 'booked', name: 'Booked', value: summary.outcome_distribution.booked },
          { key: 'declined', name: 'Declined', value: summary.outcome_distribution.declined },
          { key: 'no_match', name: 'No match', value: summary.outcome_distribution.no_match },
          {
            key: 'transferred',
            name: 'Transferred',
            value: summary.outcome_distribution.transferred,
          },
          { key: 'dropped', name: 'Dropped', value: summary.outcome_distribution.dropped },
        ] as const
      ).filter((d) => d.value > 0)
    : []

  const sentimentRows = summary
    ? (
        [
          { key: 'positive', name: 'Positive', count: summary.sentiment_distribution.positive },
          { key: 'neutral', name: 'Neutral', count: summary.sentiment_distribution.neutral },
          { key: 'negative', name: 'Negative', count: summary.sentiment_distribution.negative },
          {
            key: 'frustrated',
            name: 'Frustrated',
            count: summary.sentiment_distribution.frustrated,
          },
        ] as const
      ).map((row) => ({
        ...row,
        fill: SENTIMENT_BAR_COLORS[row.key] ?? '#94a3b8',
      }))
    : []

  const chartTooltipStyle = {
    backgroundColor: 'rgb(15 23 42)',
    border: '1px solid rgb(51 65 85)',
    borderRadius: '10px',
    color: '#f8fafc',
  }
  const chartLabelStyle = { color: 'rgb(226 232 240)' }
  const hasSentiment = sentimentRows.some((row) => row.count > 0)

  return (
    <PageLayout
      eyebrow="Command center"
      title="Overview"
      description="Carrier sales performance and call analytics at a glance."
    >
      <div
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
        data-testid="overview-kpi-grid"
      >
        {summary ? (
          <>
            <StatCard
              dataTestId="kpi-card-total-calls"
              label="Total Calls"
              value={String(summary.total_calls)}
              icon={PhoneCall}
              sparkline={sparkSeries}
              index={0}
            />
            <StatCard
              dataTestId="kpi-card-booking-rate"
              label="Booking Rate"
              value={formatPercent(summary.booking_rate)}
              icon={TrendingUp}
              index={1}
            />
            <StatCard
              dataTestId="kpi-card-revenue-booked"
              label="Revenue Booked"
              value={formatCurrency(summary.revenue_booked)}
              icon={DollarSign}
              index={2}
            />
            <StatCard
              dataTestId="kpi-card-avg-rounds"
              label="Avg Rounds"
              value={summary.avg_negotiation_rounds.toFixed(1)}
              icon={Repeat}
              index={3}
            />
          </>
        ) : (
          <>
            {KPI_SKELETON_KEYS.map((key) => (
              <div
                key={key}
                data-testid="kpi-skeleton"
                className="h-32 animate-pulse rounded-xl2 border border-surface-border/70 bg-surface-2"
              />
            ))}
          </>
        )}
      </div>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SectionHeader
            eyebrow="Volume"
            title="Calls over time"
            description="Last 24 sampling intervals."
          />
          {history ? (
            <div className="mt-4 h-72 w-full rounded-xl2 border border-surface-border/70 bg-surface-1 p-3">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={lineData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <XAxis
                    dataKey="timestamp"
                    tickFormatter={formatChartTime}
                    stroke="#94a3b8"
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke="#94a3b8"
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={chartTooltipStyle}
                    labelStyle={chartLabelStyle}
                    itemStyle={chartLabelStyle}
                    labelFormatter={formatChartTime}
                  />
                  <Line
                    type="monotone"
                    dataKey="total_calls"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    dot={{ r: 3, fill: '#f59e0b' }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="mt-4 h-72 animate-pulse rounded-xl2 bg-surface-2" />
          )}
        </div>

        <div>
          <SectionHeader eyebrow="Mix" title="Outcome distribution" />
          {summary === undefined ? (
            <div className="mt-4 h-72 animate-pulse rounded-xl2 bg-surface-2" />
          ) : pieData.length === 0 ? (
            <EmptyState
              className="mt-4"
              icon={PieChartIcon}
              title="No outcome data yet"
              description="Once calls close, the outcome mix will surface here."
            />
          ) : (
            <div className="mt-4 h-72 w-full rounded-xl2 border border-surface-border/70 bg-surface-1 p-3">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={54}
                    outerRadius={86}
                    paddingAngle={2}
                    stroke="none"
                  >
                    {pieData.map((entry) => (
                      <Cell key={entry.key} fill={OUTCOME_PIE_COLORS[entry.key] ?? '#94a3b8'} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={chartTooltipStyle}
                    itemStyle={chartLabelStyle}
                    labelStyle={chartLabelStyle}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <div className="mt-8">
        <SectionHeader
          eyebrow="Tone"
          title="Sentiment distribution"
          description="Live aggregate of carrier sentiment across recent calls."
        />
        {summary === undefined ? (
          <div className="mt-4 h-64 animate-pulse rounded-xl2 bg-surface-2" />
        ) : !hasSentiment ? (
          <EmptyState
            className="mt-4"
            icon={BarChart3}
            title="No sentiment signal yet"
            description="Recorded call sentiment will populate this chart."
          />
        ) : (
          <div className="mt-4 h-64 w-full rounded-xl2 border border-surface-border/70 bg-surface-1 p-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sentimentRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <XAxis
                  dataKey="name"
                  stroke="#94a3b8"
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke="#94a3b8"
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={chartTooltipStyle}
                  itemStyle={chartLabelStyle}
                  labelStyle={chartLabelStyle}
                />
                <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                  {sentimentRows.map((row) => (
                    <Cell key={row.key} fill={row.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="mt-10 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" strokeWidth={2} aria-hidden />
        Live data from Convex — updates automatically.
      </div>
    </PageLayout>
  )
}

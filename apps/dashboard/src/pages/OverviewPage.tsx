import { KpiCard } from '@/components/KpiCard'
import { formatCurrency, formatPercent } from '@/lib/formatters'
import { api } from '@carrier-sales/convex/convex/_generated/api'
import { useQuery } from 'convex/react'
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
  declined: '#f97316',
  no_match: '#6b7280',
  transferred: '#3b82f6',
  dropped: '#ef4444',
}

const SENTIMENT_BAR_COLORS: Record<string, string> = {
  positive: '#10b981',
  neutral: '#9ca3af',
  negative: '#f97316',
  frustrated: '#ef4444',
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
          {
            key: 'positive',
            name: 'Positive',
            count: summary.sentiment_distribution.positive,
          },
          {
            key: 'neutral',
            name: 'Neutral',
            count: summary.sentiment_distribution.neutral,
          },
          {
            key: 'negative',
            name: 'Negative',
            count: summary.sentiment_distribution.negative,
          },
          {
            key: 'frustrated',
            name: 'Frustrated',
            count: summary.sentiment_distribution.frustrated,
          },
        ] as const
      ).map((row) => ({
        ...row,
        fill: SENTIMENT_BAR_COLORS[row.key] ?? '#9ca3af',
      }))
    : []

  const chartTooltipStyle = {
    backgroundColor: 'rgb(17 24 39)',
    border: '1px solid rgb(55 65 81)',
    borderRadius: '0.5rem',
  }
  const chartLabelStyle = { color: 'rgb(209 213 219)' }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
          Overview
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Carrier sales performance and call analytics
        </p>
      </div>

      <div
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
        data-testid="overview-kpi-grid"
      >
        {summary ? (
          <>
            <KpiCard
              dataTestId="kpi-card-total-calls"
              title="Total Calls"
              value={String(summary.total_calls)}
            />
            <KpiCard
              dataTestId="kpi-card-booking-rate"
              title="Booking Rate"
              value={formatPercent(summary.booking_rate)}
            />
            <KpiCard
              dataTestId="kpi-card-revenue-booked"
              title="Revenue Booked"
              value={formatCurrency(summary.revenue_booked)}
            />
            <KpiCard
              dataTestId="kpi-card-avg-rounds"
              title="Avg Rounds"
              value={summary.avg_negotiation_rounds.toFixed(1)}
            />
          </>
        ) : (
          <>
            {KPI_SKELETON_KEYS.map((key) => (
              <div
                key={key}
                data-testid="kpi-skeleton"
                className="h-32 animate-pulse rounded-xl border border-gray-200 bg-gray-100 dark:border-gray-800 dark:bg-gray-800/80"
              />
            ))}
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900 lg:col-span-2">
          <h2 className="mb-4 text-sm font-medium text-gray-700 dark:text-gray-300">
            Calls over time
          </h2>
          {history ? (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={lineData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <XAxis
                    dataKey="timestamp"
                    tickFormatter={formatChartTime}
                    stroke="#9ca3af"
                    tick={{ fill: '#9ca3af', fontSize: 11 }}
                    tickLine={false}
                  />
                  <YAxis
                    stroke="#9ca3af"
                    tick={{ fill: '#9ca3af', fontSize: 11 }}
                    tickLine={false}
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
                    stroke="#3b82f6"
                    strokeWidth={2}
                    dot={{ r: 3, fill: '#3b82f6' }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-72 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800/80" />
          )}
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <h2 className="mb-4 text-sm font-medium text-gray-700 dark:text-gray-300">
            Outcome distribution
          </h2>
          {summary === undefined && (
            <div className="h-72 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800/80" />
          )}
          {summary !== undefined && pieData.length === 0 && (
            <p className="flex h-72 items-center justify-center text-sm text-gray-500 dark:text-gray-400">
              No outcome data yet
            </p>
          )}
          {summary !== undefined && pieData.length > 0 && (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={48}
                    outerRadius={80}
                    paddingAngle={2}
                  >
                    {pieData.map((entry) => (
                      <Cell key={entry.key} fill={OUTCOME_PIE_COLORS[entry.key] ?? '#6b7280'} />
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

      <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <h2 className="mb-4 text-sm font-medium text-gray-700 dark:text-gray-300">
          Sentiment distribution
        </h2>
        {summary ? (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sentimentRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <XAxis
                  dataKey="name"
                  stroke="#9ca3af"
                  tick={{ fill: '#9ca3af', fontSize: 11 }}
                  tickLine={false}
                />
                <YAxis
                  stroke="#9ca3af"
                  tick={{ fill: '#9ca3af', fontSize: 11 }}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={chartTooltipStyle}
                  itemStyle={chartLabelStyle}
                  labelStyle={chartLabelStyle}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {sentimentRows.map((row) => (
                    <Cell key={row.key} fill={row.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-64 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800/80" />
        )}
      </div>
    </div>
  )
}

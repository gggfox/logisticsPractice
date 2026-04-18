import { motion } from 'framer-motion'
import { ArrowDownRight, ArrowUpRight, type LucideIcon } from 'lucide-react'
import { Line, LineChart, ResponsiveContainer } from 'recharts'

type StatTrend = 'up' | 'down' | 'flat'

type SparkPoint = { value: number }

interface StatCardProps {
  label: string
  value: string
  icon: LucideIcon
  sparkline?: number[]
  trend?: {
    direction: StatTrend
    label: string
  }
  dataTestId?: string
  index?: number
}

export function StatCard({
  label,
  value,
  icon: Icon,
  sparkline,
  trend,
  dataTestId,
  index = 0,
}: StatCardProps) {
  const sparkData: SparkPoint[] = (sparkline ?? []).map((v) => ({ value: v }))
  const hasSparkline = sparkData.length > 1

  const trendColor =
    trend?.direction === 'up'
      ? 'text-emerald-600 dark:text-emerald-400'
      : trend?.direction === 'down'
        ? 'text-rose-600 dark:text-rose-400'
        : 'text-slate-500 dark:text-slate-400'

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.04, ease: 'easeOut' }}
      className="relative flex flex-col gap-5 rounded-xl2 border border-surface-border/70 bg-surface-1 p-5 shadow-card transition hover:shadow-card-hover"
      data-testid={dataTestId}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="eyebrow">{label}</p>
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-500/10 text-accent-600 ring-1 ring-inset ring-accent-500/20 dark:text-accent-400">
          <Icon className="h-4 w-4" strokeWidth={1.75} aria-hidden />
        </span>
      </div>
      <div>
        <p className="font-display text-[36px] leading-none tracking-tight text-slate-900 dark:text-slate-50">
          {value}
        </p>
        {trend ? (
          <p className={`mt-2 flex items-center gap-1 text-xs font-medium ${trendColor}`}>
            {trend.direction === 'up' ? (
              <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
            ) : trend.direction === 'down' ? (
              <ArrowDownRight className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
            ) : null}
            <span className="numeric">{trend.label}</span>
          </p>
        ) : null}
      </div>
      {hasSparkline ? (
        <div className="-mx-1 h-8" aria-hidden>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={sparkData}>
              <Line
                type="monotone"
                dataKey="value"
                stroke="currentColor"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
                className="text-accent-500"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </motion.div>
  )
}

interface KpiCardProps {
  title: string
  value: string
  subtitle?: string
  trend?: { value: string; positive: boolean }
  dataTestId?: string
}

export function KpiCard({ title, value, subtitle, trend, dataTestId }: KpiCardProps) {
  return (
    <div
      className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900"
      data-testid={dataTestId}
    >
      <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{title}</p>
      <div className="mt-2 flex items-baseline gap-2">
        <p className="text-3xl font-bold tracking-tight">{value}</p>
        {trend && (
          <span
            className={`text-sm font-medium ${trend.positive ? 'text-emerald-600' : 'text-red-600'}`}
          >
            {trend.positive ? '↑' : '↓'} {trend.value}
          </span>
        )}
      </div>
      {subtitle && <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{subtitle}</p>}
    </div>
  )
}

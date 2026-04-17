export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

export function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function formatDateTime(isoString: string): string {
  return new Date(isoString).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${String(secs).padStart(2, '0')}`
}

export function sentimentColor(sentiment: string): string {
  switch (sentiment) {
    case 'positive':
      return 'text-emerald-600 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-900/30'
    case 'neutral':
      return 'text-gray-600 bg-gray-100 dark:text-gray-400 dark:bg-gray-800'
    case 'negative':
      return 'text-orange-600 bg-orange-50 dark:text-orange-400 dark:bg-orange-900/30'
    case 'frustrated':
      return 'text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-900/30'
    default:
      return 'text-gray-600 bg-gray-100 dark:text-gray-400 dark:bg-gray-800'
  }
}

export function outcomeColor(outcome: string): string {
  switch (outcome) {
    case 'booked':
      return 'text-emerald-600 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-900/30'
    case 'transferred':
      return 'text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-900/30'
    case 'declined':
      return 'text-orange-600 bg-orange-50 dark:text-orange-400 dark:bg-orange-900/30'
    case 'no_match':
      return 'text-gray-600 bg-gray-100 dark:text-gray-400 dark:bg-gray-800'
    case 'dropped':
      return 'text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-900/30'
    default:
      return 'text-gray-600 bg-gray-100 dark:text-gray-400 dark:bg-gray-800'
  }
}

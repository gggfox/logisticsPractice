import { Badge } from '@/components/Badge'
import { formatDateTime, outcomeColor, sentimentColor } from '@/lib/formatters'
import { api } from '@carrier-sales/convex/convex/_generated/api'
import { useQuery } from 'convex/react'

const FEED_SKELETON_KEYS = ['sk-a', 'sk-b', 'sk-c', 'sk-d', 'sk-e', 'sk-f'] as const

type CallRecord = {
  _id: string
  call_id: string
  carrier_mc: string
  outcome?: string
  sentiment?: string
  duration_seconds?: number
  started_at: string
}

function outcomeBorderClass(outcome: string | undefined): string {
  switch (outcome) {
    case 'booked':
      return 'border-l-emerald-500'
    case 'declined':
      return 'border-l-orange-500'
    case 'no_match':
      return 'border-l-gray-500'
    case 'transferred':
      return 'border-l-blue-500'
    case 'dropped':
      return 'border-l-red-500'
    default:
      return 'border-l-gray-400 dark:border-l-gray-600'
  }
}

function formatOutcomeLabel(outcome: string | undefined): string {
  if (!outcome) return 'Unknown'
  return outcome
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function formatSentimentLabel(sentiment: string | undefined): string {
  if (!sentiment) return 'Unknown'
  return sentiment.charAt(0).toUpperCase() + sentiment.slice(1)
}

function formatDurationSeconds(seconds: number | undefined): string {
  if (typeof seconds === 'number') return String(seconds)
  return '—'
}

function CallFeedBody({ calls }: Readonly<{ calls: CallRecord[] | undefined }>) {
  if (calls === undefined) {
    return (
      <ul className="divide-y divide-gray-200 dark:divide-gray-800">
        {FEED_SKELETON_KEYS.map((key) => (
          <li key={key} className="p-4">
            <div className="h-24 animate-pulse rounded-lg border border-gray-200 bg-gray-100 dark:border-gray-800 dark:bg-gray-800/80" />
          </li>
        ))}
      </ul>
    )
  }

  if (calls.length === 0) {
    return (
      <div className="flex min-h-[240px] flex-col items-center justify-center gap-2 px-6 py-16 text-center">
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">No calls yet</p>
        <p className="max-w-sm text-sm text-gray-500 dark:text-gray-400">
          Completed calls will appear here in real time as they are recorded.
        </p>
      </div>
    )
  }

  return (
    <ul className="divide-y divide-gray-200 dark:divide-gray-800">
      {calls.map((call) => (
        <li key={call._id}>
          <div
            className={`border-l-4 bg-white p-4 dark:bg-gray-900 ${outcomeBorderClass(call.outcome)}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {call.call_id}
                </p>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                  MC {call.carrier_mc}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge className={outcomeColor(call.outcome ?? '')}>
                  {formatOutcomeLabel(call.outcome)}
                </Badge>
                <Badge className={sentimentColor(call.sentiment ?? '')}>
                  {formatSentimentLabel(call.sentiment)}
                </Badge>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
              <span>{formatDateTime(call.started_at)}</span>
              <span>duration_seconds: {formatDurationSeconds(call.duration_seconds)}</span>
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

export function LiveFeedPage() {
  const calls = useQuery(api.calls.getRecent, { limit: 30 }) as CallRecord[] | undefined

  return (
    <div className="flex h-full min-h-0 flex-col p-6">
      <div className="mb-6 flex shrink-0 items-center gap-3">
        <div className="relative flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
        </div>
        <span className="text-sm font-semibold tracking-wide text-red-500 dark:text-red-400">
          Live
        </span>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
          Call feed
        </h1>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-gray-200 bg-gray-50/50 dark:border-gray-800 dark:bg-gray-950/50">
        <CallFeedBody calls={calls} />
      </div>
    </div>
  )
}

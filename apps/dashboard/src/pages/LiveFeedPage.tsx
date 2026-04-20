import { Badge } from '@/components/Badge'
import { CallDetailDrawer } from '@/components/CallDetailDrawer'
import { EmptyState } from '@/components/EmptyState'
import { PageLayout } from '@/components/layout/PageLayout'
import { formatDateTime } from '@/lib/formatters'
import { api } from '@carrier-sales/convex/convex/_generated/api'
import { useQuery } from 'convex/react'
import { Clock, Inbox } from 'lucide-react'
import { useState } from 'react'

const FEED_SKELETON_KEYS = ['sk-a', 'sk-b', 'sk-c', 'sk-d', 'sk-e', 'sk-f'] as const

type CallRecord = {
  _id: string
  call_id: string
  carrier_mc: string
  outcome?: string
  sentiment?: string
  duration_seconds?: number
  started_at: string
  negotiation_rounds?: number
  final_rate?: number
  transcript?: string
  speakers?: Array<{ role: string; text: string }>
}

function outcomeBorderClass(outcome: string | undefined): string {
  switch (outcome) {
    case 'booked':
      return 'border-l-emerald-500'
    case 'declined':
      return 'border-l-rose-500'
    case 'no_match':
      return 'border-l-slate-400 dark:border-l-slate-600'
    case 'transferred':
      return 'border-l-sky-500'
    case 'dropped':
      return 'border-l-red-500'
    default:
      return 'border-l-slate-300 dark:border-l-slate-700'
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
  if (typeof seconds === 'number') return `${seconds}s`
  return '—'
}

interface CallFeedBodyProps {
  calls: CallRecord[] | undefined
  onSelect: (call: CallRecord) => void
}

function CallFeedBody({ calls, onSelect }: Readonly<CallFeedBodyProps>) {
  if (calls === undefined) {
    return (
      <ul className="divide-y divide-surface-border/70">
        {FEED_SKELETON_KEYS.map((key) => (
          <li key={key} className="p-4">
            <div className="h-24 animate-pulse rounded-lg border border-surface-border/70 bg-surface-2" />
          </li>
        ))}
      </ul>
    )
  }

  if (calls.length === 0) {
    return (
      <EmptyState
        className="m-6 border-0 py-20"
        icon={Inbox}
        title="No calls yet"
        description="Completed calls will appear here in real time as they are recorded."
      />
    )
  }

  return (
    <ul className="divide-y divide-surface-border/70">
      {calls.map((call) => (
        <li key={call._id}>
          <button
            type="button"
            onClick={() => onSelect(call)}
            data-testid="live-feed-call"
            className={`group flex w-full items-start gap-4 border-l-4 bg-surface-1 px-5 py-4 text-left transition hover:bg-surface-2/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-500/40 ${outcomeBorderClass(call.outcome)}`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-mono text-[13px] font-medium text-slate-900 dark:text-slate-100">
                    {call.call_id}
                  </p>
                  <p className="mt-0.5 text-[13px] text-slate-500 dark:text-slate-400">
                    MC <span className="numeric">{call.carrier_mc}</span>
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outcome" tone={call.outcome}>
                    {formatOutcomeLabel(call.outcome)}
                  </Badge>
                  <Badge variant="sentiment" tone={call.sentiment}>
                    {formatSentimentLabel(call.sentiment)}
                  </Badge>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px] text-slate-500 dark:text-slate-400">
                <span>{formatDateTime(call.started_at)}</span>
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="h-3 w-3" strokeWidth={1.75} aria-hidden />
                  <span className="numeric">{formatDurationSeconds(call.duration_seconds)}</span>
                </span>
              </div>
            </div>
          </button>
        </li>
      ))}
    </ul>
  )
}

export function LiveFeedPage() {
  const calls = useQuery(api.calls.getRecent, { limit: 30 }) as CallRecord[] | undefined
  const [selectedCall, setSelectedCall] = useState<CallRecord | null>(null)

  const liveBadge = (
    <span className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500" />
      </span>
      Live
    </span>
  )

  return (
    <PageLayout
      eyebrow="Realtime"
      title="Call feed"
      description="Completed calls stream in here the moment they close."
      mode="fixed"
      actions={liveBadge}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl2 border border-surface-border/70 bg-surface-1 shadow-card">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <CallFeedBody calls={calls} onSelect={setSelectedCall} />
        </div>
      </div>
      <CallDetailDrawer call={selectedCall} onClose={() => setSelectedCall(null)} />
    </PageLayout>
  )
}

import { Badge } from '@/components/Badge'
import { CallConversation } from '@/components/CallConversation'
import { EmptyState } from '@/components/EmptyState'
import { PageLayout } from '@/components/layout/PageLayout'
import { formatCurrency, formatDateTime, formatDuration } from '@/lib/formatters'
import { api } from '@carrier-sales/convex/convex/_generated/api'
import { useQuery } from 'convex/react'
import { ChevronRight, Download, SlidersHorizontal } from 'lucide-react'
import { Fragment, type KeyboardEvent, useState } from 'react'

type OutcomeFilter = 'all' | 'booked' | 'declined' | 'no_match' | 'transferred' | 'dropped'

type SentimentFilter = 'all' | 'positive' | 'neutral' | 'negative' | 'frustrated'

function matchesOutcomeFilter(call: { outcome?: string }, filter: OutcomeFilter): boolean {
  if (filter === 'all') return true
  return call.outcome === filter
}

function matchesSentimentFilter(call: { sentiment?: string }, filter: SentimentFilter): boolean {
  if (filter === 'all') return true
  return call.sentiment === filter
}

function escapeCsvCell(value: string): string {
  if (value.includes('"') || value.includes(',') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function labelFromKey(value: string | undefined): string {
  if (!value) return '—'
  return value.replace(/_/g, ' ')
}

type CallRowData = {
  _id: string
  call_id: string
  carrier_mc: string
  started_at: string
  outcome?: string
  sentiment?: string
  negotiation_rounds: number
  final_rate?: number
  duration_seconds?: number
  transcript?: string
  speakers?: Array<{ role: string; text: string }>
}

interface CallRowProps {
  call: CallRowData
  expanded: boolean
  onToggle: () => void
}

function CallRow({ call, expanded, onToggle }: CallRowProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onToggle()
    }
  }

  return (
    <Fragment>
      <tr
        onClick={onToggle}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        aria-expanded={expanded}
        className="cursor-pointer border-l-2 border-l-transparent transition-colors hover:border-l-accent-500 hover:bg-surface-2/50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-accent-500/30"
      >
        <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700 dark:text-slate-300">
          {formatDateTime(call.started_at)}
        </td>
        <td className="max-w-[160px] truncate px-4 py-3 font-mono text-xs text-slate-800 dark:text-slate-200">
          {call.call_id}
        </td>
        <td className="whitespace-nowrap px-4 py-3 font-mono text-sm text-slate-800 dark:text-slate-200">
          {call.carrier_mc}
        </td>
        <td className="px-4 py-3">
          <Badge variant="outcome" tone={call.outcome}>
            {labelFromKey(call.outcome)}
          </Badge>
        </td>
        <td className="px-4 py-3">
          <Badge variant="sentiment" tone={call.sentiment}>
            {labelFromKey(call.sentiment)}
          </Badge>
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-sm numeric text-slate-800 dark:text-slate-200">
          {call.negotiation_rounds}
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-sm numeric text-slate-800 dark:text-slate-200">
          {call.final_rate !== undefined ? formatCurrency(call.final_rate) : '—'}
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-sm numeric text-slate-800 dark:text-slate-200">
          <span className="inline-flex w-full items-center justify-between gap-2">
            <span>
              {call.duration_seconds !== undefined ? formatDuration(call.duration_seconds) : '—'}
            </span>
            <ChevronRight
              className="h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform"
              style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
              strokeWidth={2}
              aria-hidden
            />
          </span>
        </td>
      </tr>
      {expanded ? (
        <tr className="bg-surface-2/60">
          <td colSpan={8} className="px-4 py-4">
            <p className="eyebrow">Conversation</p>
            <div className="mt-2">
              <CallConversation speakers={call.speakers} transcript={call.transcript} />
            </div>
          </td>
        </tr>
      ) : null}
    </Fragment>
  )
}

export function CallHistoryPage() {
  const calls = useQuery(api.calls.getAll)
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>('all')
  const [sentimentFilter, setSentimentFilter] = useState<SentimentFilter>('all')
  const [expandedCallId, setExpandedCallId] = useState<string | null>(null)

  const filteredCalls =
    calls?.filter(
      (c) => matchesOutcomeFilter(c, outcomeFilter) && matchesSentimentFilter(c, sentimentFilter),
    ) ?? []

  const exportCsv = () => {
    const headers = [
      'Date',
      'Call ID',
      'Carrier MC#',
      'Outcome',
      'Sentiment',
      'Rounds',
      'Final Rate',
      'Duration (formatted)',
      'Duration (seconds)',
    ]
    const lines = [
      headers.map(escapeCsvCell).join(','),
      ...filteredCalls.map((c) =>
        [
          formatDateTime(c.started_at),
          c.call_id,
          c.carrier_mc,
          c.outcome ?? '',
          c.sentiment ?? '',
          String(c.negotiation_rounds),
          c.final_rate !== undefined ? formatCurrency(c.final_rate) : '',
          c.duration_seconds !== undefined ? formatDuration(c.duration_seconds) : '',
          c.duration_seconds !== undefined ? String(c.duration_seconds) : '',
        ]
          .map((cell) => escapeCsvCell(String(cell)))
          .join(','),
      ),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `call-history-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const isLoading = calls === undefined

  const exportAction = (
    <button
      type="button"
      onClick={exportCsv}
      disabled={isLoading || filteredCalls.length === 0}
      className="inline-flex items-center gap-2 rounded-lg border border-surface-border/70 bg-surface-1 px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-200"
    >
      <Download className="h-4 w-4" strokeWidth={1.75} aria-hidden />
      Export CSV
    </button>
  )

  return (
    <PageLayout
      eyebrow="Archive"
      title="Call history"
      description="Review outcomes, sentiment, and transcripts from carrier sales calls."
      mode="fixed"
      actions={exportAction}
    >
      <div
        className="flex shrink-0 flex-wrap items-end gap-4 rounded-xl2 border border-surface-border/70 bg-surface-1 p-4 shadow-card"
        data-testid="call-history-filters"
      >
        <div className="inline-flex h-9 items-center gap-2 rounded-lg bg-surface-2 px-3 text-xs font-medium text-slate-500 dark:text-slate-400">
          <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
          Filters
        </div>
        <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Outcome
          <select
            value={outcomeFilter}
            onChange={(e) => setOutcomeFilter(e.target.value as OutcomeFilter)}
            className="rounded-lg border border-surface-border/70 bg-surface-1 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/30 dark:text-slate-100"
          >
            <option value="all">All outcomes</option>
            <option value="booked">Booked</option>
            <option value="declined">Declined</option>
            <option value="no_match">No match</option>
            <option value="transferred">Transferred</option>
            <option value="dropped">Dropped</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Sentiment
          <select
            value={sentimentFilter}
            onChange={(e) => setSentimentFilter(e.target.value as SentimentFilter)}
            className="rounded-lg border border-surface-border/70 bg-surface-1 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/30 dark:text-slate-100"
          >
            <option value="all">All sentiments</option>
            <option value="positive">Positive</option>
            <option value="neutral">Neutral</option>
            <option value="negative">Negative</option>
            <option value="frustrated">Frustrated</option>
          </select>
        </label>
        <p className="ml-auto text-xs text-slate-500 dark:text-slate-400">
          {isLoading
            ? 'Loading…'
            : `${filteredCalls.length} call${filteredCalls.length === 1 ? '' : 's'}`}
        </p>
      </div>

      <div className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl2 border border-surface-border/70 bg-surface-1 shadow-card">
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="min-w-full divide-y divide-surface-border/70">
            <thead className="sticky top-0 z-10 bg-surface-1/95 backdrop-blur">
              <tr>
                {[
                  'Date',
                  'Call ID',
                  'Carrier MC#',
                  'Outcome',
                  'Sentiment',
                  'Rounds',
                  'Final rate',
                  'Duration',
                ].map((h) => (
                  <th
                    key={h}
                    scope="col"
                    className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border/70">
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={`sk-${String(i)}`}>
                    {Array.from({ length: 8 }).map((__, j) => (
                      <td key={`sk-${String(i)}-${String(j)}`} className="px-4 py-3">
                        <div className="h-4 animate-pulse rounded bg-surface-2" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filteredCalls.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-0">
                    <EmptyState
                      className="m-6 border-0 py-16"
                      icon={SlidersHorizontal}
                      title="No calls match"
                      description="Try clearing a filter or changing your outcome/sentiment selection."
                    />
                  </td>
                </tr>
              ) : (
                filteredCalls.map((call) => {
                  const expanded = expandedCallId === call.call_id
                  return (
                    <CallRow
                      key={call._id}
                      call={call}
                      expanded={expanded}
                      onToggle={() => setExpandedCallId(expanded ? null : call.call_id)}
                    />
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </PageLayout>
  )
}

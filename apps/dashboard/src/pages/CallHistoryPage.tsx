import { Badge } from '@/components/Badge'
import {
  formatCurrency,
  formatDateTime,
  formatDuration,
  outcomeColor,
  sentimentColor,
} from '@/lib/formatters'
import { api } from '@carrier-sales/convex/convex/_generated/api'
import { useQuery } from 'convex/react'
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
}

interface CallRowProps {
  call: CallRowData
  expanded: boolean
  onToggle: () => void
}

function CallRow({ call, expanded, onToggle }: CallRowProps) {
  const outcomeKey = call.outcome ?? 'unknown'
  const sentimentKey = call.sentiment ?? 'unknown'
  const transcriptText = call.transcript?.trim() ?? ''

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
        className="cursor-pointer transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:hover:bg-gray-800/60"
      >
        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-900 dark:text-gray-100">
          {formatDateTime(call.started_at)}
        </td>
        <td className="max-w-[140px] truncate px-4 py-3 font-mono text-xs text-gray-800 dark:text-gray-200">
          {call.call_id}
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-800 dark:text-gray-200">
          {call.carrier_mc}
        </td>
        <td className="px-4 py-3">
          <Badge className={outcomeColor(outcomeKey === 'unknown' ? '' : outcomeKey)}>
            {labelFromKey(call.outcome)}
          </Badge>
        </td>
        <td className="px-4 py-3">
          <Badge className={sentimentColor(sentimentKey === 'unknown' ? '' : sentimentKey)}>
            {labelFromKey(call.sentiment)}
          </Badge>
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-sm tabular-nums text-gray-800 dark:text-gray-200">
          {call.negotiation_rounds}
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-sm tabular-nums text-gray-800 dark:text-gray-200">
          {call.final_rate !== undefined ? formatCurrency(call.final_rate) : '—'}
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-800 dark:text-gray-200">
          <span className="inline-flex w-full items-center justify-between gap-2 tabular-nums">
            <span>
              {call.duration_seconds !== undefined ? formatDuration(call.duration_seconds) : '—'}
            </span>
            <span
              className="inline-block shrink-0 text-gray-500 transition-transform dark:text-gray-400"
              style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
              aria-hidden
            >
              ›
            </span>
          </span>
        </td>
      </tr>
      {expanded ? (
        <tr className="bg-gray-50/80 dark:bg-gray-900/60">
          <td colSpan={8} className="px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Transcript
            </p>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-gray-200 bg-white p-3 font-sans text-sm text-gray-800 dark:border-gray-600 dark:bg-gray-950 dark:text-gray-200">
              {transcriptText || 'No transcript available.'}
            </pre>
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
            Call history
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Review outcomes, sentiment, and transcripts from carrier sales calls.
          </p>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          disabled={isLoading || filteredCalls.length === 0}
          className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          Export CSV
        </button>
      </div>

      <div
        className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900/40"
        data-testid="call-history-filters"
      >
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
          Outcome
          <select
            value={outcomeFilter}
            onChange={(e) => setOutcomeFilter(e.target.value as OutcomeFilter)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
          >
            <option value="all">All outcomes</option>
            <option value="booked">Booked</option>
            <option value="declined">Declined</option>
            <option value="no_match">No match</option>
            <option value="transferred">Transferred</option>
            <option value="dropped">Dropped</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
          Sentiment
          <select
            value={sentimentFilter}
            onChange={(e) => setSentimentFilter(e.target.value as SentimentFilter)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
          >
            <option value="all">All sentiments</option>
            <option value="positive">Positive</option>
            <option value="neutral">Neutral</option>
            <option value="negative">Negative</option>
            <option value="frustrated">Frustrated</option>
          </select>
        </label>
        <p className="ml-auto text-xs text-gray-500 dark:text-gray-500">
          {isLoading
            ? 'Loading…'
            : `${filteredCalls.length} call${filteredCalls.length === 1 ? '' : 's'}`}
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900/40">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900/80">
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
                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={`sk-${String(i)}`}>
                    {Array.from({ length: 8 }).map((__, j) => (
                      <td key={`sk-${String(i)}-${String(j)}`} className="px-4 py-3">
                        <div className="h-4 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filteredCalls.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-12 text-center text-sm text-gray-500 dark:text-gray-400"
                  >
                    No calls match the current filters.
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
    </div>
  )
}

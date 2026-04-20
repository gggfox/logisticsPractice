import { Badge } from '@/components/Badge'
import { CallConversation } from '@/components/CallConversation'
import { formatCurrency, formatDateTime, formatDuration } from '@/lib/formatters'
import { X } from 'lucide-react'
import { useEffect } from 'react'

export interface CallDetailData {
  _id: string
  call_id: string
  carrier_mc: string
  started_at: string
  outcome?: string
  sentiment?: string
  duration_seconds?: number
  negotiation_rounds?: number
  final_rate?: number
  transcript?: string
  speakers?: Array<{ role: string; text: string }>
}

interface CallDetailDrawerProps {
  call: CallDetailData | null
  onClose: () => void
}

function labelFromKey(value: string | undefined): string {
  if (!value) return '—'
  return value.replace(/_/g, ' ')
}

export function CallDetailDrawer({ call, onClose }: Readonly<CallDetailDrawerProps>) {
  // `Escape` closes regardless of which element inside the drawer has
  // focus. Scoped effect so we don't leak the listener when the drawer
  // is hidden.
  useEffect(() => {
    if (!call) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [call, onClose])

  if (!call) return null

  return (
    <div className="fixed inset-0 z-40 flex">
      <button
        type="button"
        aria-label="Close call details"
        onClick={onClose}
        className="flex-1 bg-slate-950/40 backdrop-blur-sm"
      />
      <aside
        aria-modal="true"
        aria-label={`Call ${call.call_id} details`}
        data-testid="call-detail-drawer"
        className="flex h-full w-full max-w-lg flex-col border-l border-surface-border/70 bg-surface-1 shadow-2xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-surface-border/70 px-5 py-4">
          <div className="min-w-0">
            <p className="eyebrow">Call</p>
            <p className="truncate font-mono text-sm font-medium text-slate-900 dark:text-slate-100">
              {call.call_id}
            </p>
            <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">
              MC <span className="numeric">{call.carrier_mc}</span>
              <span className="mx-2">·</span>
              {formatDateTime(call.started_at)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-slate-500 transition hover:bg-surface-2 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40 dark:text-slate-400 dark:hover:text-slate-100"
          >
            <X className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outcome" tone={call.outcome}>
              {labelFromKey(call.outcome)}
            </Badge>
            <Badge variant="sentiment" tone={call.sentiment}>
              {labelFromKey(call.sentiment)}
            </Badge>
          </div>

          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <dt className="eyebrow">Duration</dt>
              <dd className="mt-1 numeric text-slate-800 dark:text-slate-200">
                {call.duration_seconds !== undefined ? formatDuration(call.duration_seconds) : '—'}
              </dd>
            </div>
            <div>
              <dt className="eyebrow">Rounds</dt>
              <dd className="mt-1 numeric text-slate-800 dark:text-slate-200">
                {call.negotiation_rounds ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="eyebrow">Final rate</dt>
              <dd className="mt-1 numeric text-slate-800 dark:text-slate-200">
                {call.final_rate !== undefined ? formatCurrency(call.final_rate) : '—'}
              </dd>
            </div>
          </dl>

          <div>
            <p className="eyebrow mb-2">Conversation</p>
            <CallConversation speakers={call.speakers} transcript={call.transcript} />
          </div>
        </div>
      </aside>
    </div>
  )
}

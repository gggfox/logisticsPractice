import { Badge } from '@/components/Badge'
import { EmptyState } from '@/components/EmptyState'
import { PageLayout } from '@/components/layout/PageLayout'
import { formatDateTime } from '@/lib/formatters'
import { api } from '@carrier-sales/convex/convex/_generated/api'
import { useQuery } from 'convex/react'
import { Building2, Search } from 'lucide-react'
import { useMemo, useState } from 'react'

type CarrierDoc = {
  _id: string
  mc_number: string
  legal_name: string
  dot_number: string
  operating_status: string
  is_eligible: boolean
  verified_at: string
}

type CallDoc = {
  carrier_mc: string
  outcome?: string
}

function buildCarrierStats(calls: CallDoc[]) {
  const byMc = new Map<string, { count: number; booked: number }>()
  for (const c of calls) {
    const cur = byMc.get(c.carrier_mc) ?? { count: 0, booked: 0 }
    cur.count += 1
    if (c.outcome === 'booked') cur.booked += 1
    byMc.set(c.carrier_mc, cur)
  }
  return byMc
}

function CarrierTableSkeleton() {
  return (
    <div className="animate-pulse space-y-3 rounded-xl2 border border-surface-border/70 bg-surface-1 p-4 shadow-card">
      <div className="h-10 rounded-lg bg-surface-2" />
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="h-12 rounded-lg bg-surface-2" />
      ))}
    </div>
  )
}

export function CarrierIntelPage() {
  const carriers = useQuery(api.carriers.getAll) as CarrierDoc[] | undefined
  const calls = useQuery(api.calls.getAll) as CallDoc[] | undefined
  const [search, setSearch] = useState('')

  const statsByMc = useMemo(() => (calls ? buildCarrierStats(calls) : null), [calls])

  const filteredCarriers = useMemo(() => {
    if (!carriers) return []
    const q = search.trim().toLowerCase()
    if (!q) return carriers
    return carriers.filter(
      (c) => c.legal_name.toLowerCase().includes(q) || c.mc_number.toLowerCase().includes(q),
    )
  }, [carriers, search])

  const loading = carriers === undefined || calls === undefined

  return (
    <PageLayout
      eyebrow="Counterparties"
      title="Carrier intelligence"
      description="FMCSA snapshot, eligibility, and call performance by motor carrier."
    >
      <div className="max-w-md">
        <label htmlFor="carrier-search" className="sr-only">
          Search carriers
        </label>
        <span className="relative block">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            strokeWidth={1.75}
            aria-hidden
          />
          <input
            id="carrier-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by legal name or MC number…"
            className="w-full rounded-lg border border-surface-border/70 bg-surface-1 py-2 pl-9 pr-3 text-sm text-slate-900 shadow-sm placeholder:text-slate-500 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/30 dark:text-slate-100"
          />
        </span>
      </div>

      <div className="mt-6">
        {loading ? (
          <CarrierTableSkeleton />
        ) : filteredCarriers.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="No carriers match your search"
            description="Try a different legal name or MC number."
          />
        ) : (
          <div className="overflow-hidden rounded-xl2 border border-surface-border/70 bg-surface-1 shadow-card">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-surface-border/70">
                <thead className="bg-surface-2/60">
                  <tr>
                    {[
                      'MC Number',
                      'Legal Name',
                      'DOT Number',
                      'Operating Status',
                      'Eligible',
                      'Verified At',
                      'Call Count',
                      'Booking Rate',
                    ].map((col) => (
                      <th
                        key={col}
                        scope="col"
                        className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-border/70">
                  {filteredCarriers.map((row) => {
                    const s = statsByMc?.get(row.mc_number)
                    const callCount = s?.count ?? 0
                    const bookingRate = callCount > 0 ? (s?.booked ?? 0) / callCount : 0
                    return (
                      <tr
                        key={row._id}
                        className="border-l-2 border-l-transparent transition-colors hover:border-l-accent-500 hover:bg-surface-2/40"
                      >
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-sm text-slate-900 dark:text-slate-100">
                          {row.mc_number}
                        </td>
                        <td className="max-w-[240px] truncate px-4 py-3 text-sm text-slate-900 dark:text-slate-100">
                          {row.legal_name}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-sm text-slate-700 dark:text-slate-300">
                          {row.dot_number}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm capitalize text-slate-700 dark:text-slate-300">
                          {row.operating_status.toLowerCase()}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          {row.is_eligible ? (
                            <Badge variant="outcome" tone="booked">
                              Yes
                            </Badge>
                          ) : (
                            <Badge variant="outcome" tone="dropped">
                              No
                            </Badge>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700 dark:text-slate-300">
                          {formatDateTime(row.verified_at)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-sm numeric text-slate-900 dark:text-slate-100">
                          {callCount}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-sm numeric text-slate-900 dark:text-slate-100">
                          {callCount === 0 ? '—' : `${(bookingRate * 100).toFixed(1)}%`}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </PageLayout>
  )
}

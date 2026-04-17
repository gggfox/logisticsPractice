import { Badge } from '@/components/Badge'
import { formatDateTime } from '@/lib/formatters'
import { api } from '@carrier-sales/convex/convex/_generated/api'
import { useQuery } from 'convex/react'
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
    <div className="animate-pulse space-y-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="h-10 rounded-lg bg-gray-200 dark:bg-gray-800" />
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="h-12 rounded-lg bg-gray-100 dark:bg-gray-800/80" />
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
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
          Carrier intelligence
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          FMCSA snapshot, eligibility, and call performance by motor carrier.
        </p>
      </header>

      <div className="max-w-md">
        <label htmlFor="carrier-search" className="sr-only">
          Search carriers
        </label>
        <input
          id="carrier-search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by legal name or MC number…"
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm placeholder:text-gray-500 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500"
        />
      </div>

      {loading ? (
        <CarrierTableSkeleton />
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800">
              <thead className="bg-gray-50 dark:bg-gray-950/50">
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
                      className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {filteredCarriers.map((row) => {
                  const s = statsByMc?.get(row.mc_number)
                  const callCount = s?.count ?? 0
                  const bookingRate = callCount > 0 ? (s?.booked ?? 0) / callCount : 0
                  return (
                    <tr key={row._id} className="hover:bg-gray-50/80 dark:hover:bg-gray-800/40">
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-sm text-gray-900 dark:text-gray-100">
                        {row.mc_number}
                      </td>
                      <td className="max-w-[220px] truncate px-4 py-3 text-sm text-gray-900 dark:text-gray-100">
                        {row.legal_name}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-sm text-gray-700 dark:text-gray-300">
                        {row.dot_number}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                        {row.operating_status}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {row.is_eligible ? (
                          <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                            Yes
                          </Badge>
                        ) : (
                          <Badge className="bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300">
                            No
                          </Badge>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                        {formatDateTime(row.verified_at)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-sm text-gray-900 dark:text-gray-100">
                        {callCount}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-sm text-gray-900 dark:text-gray-100">
                        {callCount === 0 ? '—' : `${(bookingRate * 100).toFixed(1)}%`}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {filteredCarriers.length === 0 && (
            <p className="border-t border-gray-200 px-4 py-6 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
              No carriers match your search.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

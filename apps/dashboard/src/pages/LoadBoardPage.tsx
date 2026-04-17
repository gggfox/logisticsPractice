import { Badge } from '@/components/Badge'
import { LoadMap } from '@/components/LoadMap'
import { formatCurrency, formatDate } from '@/lib/formatters'
import { api } from '@carrier-sales/convex/convex/_generated/api'
import { EQUIPMENT_TYPES, LOAD_STATUSES } from '@carrier-sales/shared'
import type { EquipmentType, LoadStatus } from '@carrier-sales/shared'
import { useQuery } from 'convex/react'
import { useState } from 'react'

type EquipmentFilter = 'all' | EquipmentType

type StatusFilter = 'all' | LoadStatus

function loadStatusBadgeClass(status: string): string {
  switch (status) {
    case 'available':
      return 'text-emerald-600 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-900/30'
    case 'in_negotiation':
      return 'text-yellow-600 bg-yellow-50 dark:text-yellow-400 dark:bg-yellow-900/30'
    case 'booked':
      return 'text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-900/30'
    case 'expired':
      return 'text-gray-600 bg-gray-100 dark:text-gray-400 dark:bg-gray-800'
    default:
      return 'text-gray-600 bg-gray-100 dark:text-gray-400 dark:bg-gray-800'
  }
}

function labelStatus(status: string): string {
  return status.replace(/_/g, ' ')
}

function labelEquipment(type: string): string {
  return type.replace(/_/g, ' ')
}

export function LoadBoardPage() {
  const loads = useQuery(api.loads.getAll)
  const [search, setSearch] = useState('')
  const [equipmentFilter, setEquipmentFilter] = useState<EquipmentFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const filteredLoads =
    loads?.filter((load) => {
      if (equipmentFilter !== 'all' && load.equipment_type !== equipmentFilter) {
        return false
      }
      if (statusFilter !== 'all' && load.status !== statusFilter) {
        return false
      }
      const q = search.trim().toLowerCase()
      if (q) {
        const origin = load.origin.toLowerCase()
        const dest = load.destination.toLowerCase()
        if (!origin.includes(q) && !dest.includes(q)) {
          return false
        }
      }
      return true
    }) ?? []

  const isLoading = loads === undefined

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
          Load board
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Search lanes, filter by equipment and status, and track posted rates.
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900/40 lg:flex-row lg:flex-wrap lg:items-end">
        <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
          Search origin / destination
          <input
            type="search"
            data-testid="load-board-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="e.g. Dallas, CA-TX…"
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500"
          />
        </label>
        <label className="flex min-w-[160px] flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
          Equipment
          <select
            value={equipmentFilter}
            onChange={(e) => setEquipmentFilter(e.target.value as EquipmentFilter)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
          >
            <option value="all">All equipment</option>
            {EQUIPMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {labelEquipment(t)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-[160px] flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
          Status
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
          >
            <option value="all">All statuses</option>
            {LOAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {labelStatus(s)}
              </option>
            ))}
          </select>
        </label>
        <p className="pb-2 text-xs text-gray-500 lg:ml-auto dark:text-gray-500">
          {isLoading
            ? 'Loading…'
            : `${filteredLoads.length} load${filteredLoads.length === 1 ? '' : 's'}`}
        </p>
      </div>

      {!isLoading && filteredLoads.length > 0 && (
        <LoadMap
          loads={filteredLoads.map((l) => ({
            load_id: l.load_id,
            origin: l.origin,
            destination: l.destination,
            status: l.status,
            loadboard_rate: l.loadboard_rate,
          }))}
        />
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={`sk-${String(i)}`}
              className="animate-pulse rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900/40"
            >
              <div className="h-5 w-2/3 rounded bg-gray-200 dark:bg-gray-700" />
              <div className="mt-4 h-4 w-full rounded bg-gray-200 dark:bg-gray-700" />
              <div className="mt-2 h-4 w-5/6 rounded bg-gray-200 dark:bg-gray-700" />
              <div className="mt-6 grid grid-cols-2 gap-3">
                <div className="h-10 rounded bg-gray-200 dark:bg-gray-700" />
                <div className="h-10 rounded bg-gray-200 dark:bg-gray-700" />
              </div>
            </div>
          ))}
        </div>
      ) : filteredLoads.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50/50 px-6 py-16 text-center text-sm text-gray-600 dark:border-gray-600 dark:bg-gray-900/30 dark:text-gray-400">
          No loads match your filters.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredLoads.map((load) => (
            <article
              key={load._id}
              className="flex flex-col rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:border-gray-300 hover:shadow-md dark:border-gray-700 dark:bg-gray-900/40 dark:hover:border-gray-600"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-mono text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {load.load_id}
                </h2>
                <Badge className={loadStatusBadgeClass(load.status)}>
                  {labelStatus(load.status)}
                </Badge>
              </div>
              <p className="mt-3 text-lg font-medium leading-snug text-gray-900 dark:text-gray-100">
                {load.origin}
                <span className="mx-2 text-gray-400 dark:text-gray-500">→</span>
                {load.destination}
              </p>
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-500">
                    Pickup
                  </dt>
                  <dd className="mt-0.5 text-gray-800 dark:text-gray-200">
                    {formatDate(load.pickup_datetime)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-500">
                    Equipment
                  </dt>
                  <dd className="mt-0.5 capitalize text-gray-800 dark:text-gray-200">
                    {labelEquipment(load.equipment_type)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-500">
                    Weight
                  </dt>
                  <dd className="mt-0.5 tabular-nums text-gray-800 dark:text-gray-200">
                    {load.weight.toLocaleString()} lbs
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-500">
                    Miles
                  </dt>
                  <dd className="mt-0.5 tabular-nums text-gray-800 dark:text-gray-200">
                    {load.miles.toLocaleString()}
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-500">
                    Loadboard rate
                  </dt>
                  <dd className="mt-0.5 text-lg font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                    {formatCurrency(load.loadboard_rate)}
                  </dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

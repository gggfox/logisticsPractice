import { Badge } from '@/components/Badge'
import { EmptyState } from '@/components/EmptyState'
import { LoadMap } from '@/components/LoadMap'
import { PageLayout } from '@/components/layout/PageLayout'
import { formatCurrency, formatDate } from '@/lib/formatters'
import { api } from '@carrier-sales/convex/convex/_generated/api'
import { EQUIPMENT_TYPES, LOAD_STATUSES } from '@carrier-sales/shared'
import type { EquipmentType, LoadStatus } from '@carrier-sales/shared'
import { useQuery } from 'convex/react'
import { ArrowRight, MapPin, Search, Truck } from 'lucide-react'
import { useState } from 'react'

type EquipmentFilter = 'all' | EquipmentType

type StatusFilter = 'all' | LoadStatus

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
      if (equipmentFilter !== 'all' && load.equipment_type !== equipmentFilter) return false
      if (statusFilter !== 'all' && load.status !== statusFilter) return false
      const q = search.trim().toLowerCase()
      if (q) {
        const origin = load.origin.toLowerCase()
        const dest = load.destination.toLowerCase()
        if (!origin.includes(q) && !dest.includes(q)) return false
      }
      return true
    }) ?? []

  const isLoading = loads === undefined

  return (
    <PageLayout
      eyebrow="Lanes"
      title="Load board"
      description="Search lanes, filter by equipment and status, and track posted rates."
    >
      <div className="flex flex-col gap-3 rounded-xl2 border border-surface-border/70 bg-surface-1 p-4 shadow-card lg:flex-row lg:flex-wrap lg:items-end">
        <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Search origin / destination
          <span className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              strokeWidth={1.75}
              aria-hidden
            />
            <input
              type="search"
              data-testid="load-board-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="e.g. Dallas, CA-TX…"
              className="w-full rounded-lg border border-surface-border/70 bg-surface-1 py-2 pl-9 pr-3 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/30 dark:text-slate-100"
            />
          </span>
        </label>
        <label className="flex min-w-[160px] flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Equipment
          <select
            value={equipmentFilter}
            onChange={(e) => setEquipmentFilter(e.target.value as EquipmentFilter)}
            className="rounded-lg border border-surface-border/70 bg-surface-1 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/30 dark:text-slate-100"
          >
            <option value="all">All equipment</option>
            {EQUIPMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {labelEquipment(t)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-[160px] flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Status
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="rounded-lg border border-surface-border/70 bg-surface-1 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/30 dark:text-slate-100"
          >
            <option value="all">All statuses</option>
            {LOAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {labelStatus(s)}
              </option>
            ))}
          </select>
        </label>
        <p className="pb-2 text-xs text-slate-500 lg:ml-auto dark:text-slate-400">
          {isLoading
            ? 'Loading…'
            : `${filteredLoads.length} load${filteredLoads.length === 1 ? '' : 's'}`}
        </p>
      </div>

      {!isLoading && filteredLoads.length > 0 && (
        <div className="mt-6 overflow-hidden rounded-xl2 border border-surface-border/70 shadow-card">
          <LoadMap
            loads={filteredLoads.map((l) => ({
              load_id: l.load_id,
              origin: l.origin,
              destination: l.destination,
              status: l.status,
              loadboard_rate: l.loadboard_rate,
            }))}
          />
        </div>
      )}

      {isLoading ? (
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={`sk-${String(i)}`}
              className="animate-pulse rounded-xl2 border border-surface-border/70 bg-surface-1 p-5"
            >
              <div className="h-5 w-2/3 rounded bg-surface-2" />
              <div className="mt-4 h-4 w-full rounded bg-surface-2" />
              <div className="mt-2 h-4 w-5/6 rounded bg-surface-2" />
              <div className="mt-6 grid grid-cols-2 gap-3">
                <div className="h-10 rounded bg-surface-2" />
                <div className="h-10 rounded bg-surface-2" />
              </div>
            </div>
          ))}
        </div>
      ) : filteredLoads.length === 0 ? (
        <EmptyState
          className="mt-6"
          icon={Truck}
          title="No loads match your filters"
          description="Broaden equipment or status, or clear the search query."
        />
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredLoads.map((load) => (
            <article
              key={load._id}
              className="group flex flex-col rounded-xl2 border border-surface-border/70 bg-surface-1 p-5 shadow-card transition hover:-translate-y-0.5 hover:shadow-card-hover"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-mono text-[13px] font-semibold text-slate-900 dark:text-slate-100">
                  {load.load_id}
                </h2>
                <Badge variant="status" tone={load.status}>
                  {labelStatus(load.status)}
                </Badge>
              </div>
              <p className="mt-4 flex flex-wrap items-baseline gap-2 font-display text-[22px] leading-snug text-slate-900 dark:text-slate-50">
                <span>{load.origin}</span>
                <ArrowRight
                  className="h-4 w-4 translate-y-1 text-accent-500"
                  strokeWidth={1.75}
                  aria-hidden
                />
                <span>{load.destination}</span>
              </p>
              <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <div>
                  <dt className="eyebrow">Pickup</dt>
                  <dd className="mt-0.5 text-slate-800 dark:text-slate-200">
                    {formatDate(load.pickup_datetime)}
                  </dd>
                </div>
                <div>
                  <dt className="eyebrow">Equipment</dt>
                  <dd className="mt-0.5 capitalize text-slate-800 dark:text-slate-200">
                    {labelEquipment(load.equipment_type)}
                  </dd>
                </div>
                <div>
                  <dt className="eyebrow">Weight</dt>
                  <dd className="mt-0.5 numeric text-slate-800 dark:text-slate-200">
                    {load.weight.toLocaleString()} lbs
                  </dd>
                </div>
                <div>
                  <dt className="eyebrow">Miles</dt>
                  <dd className="mt-0.5 numeric text-slate-800 dark:text-slate-200">
                    {load.miles.toLocaleString()}
                  </dd>
                </div>
                <div className="col-span-2 flex items-end justify-between border-t border-surface-border/60 pt-3">
                  <div>
                    <dt className="eyebrow">Loadboard rate</dt>
                    <dd className="mt-0.5 font-display text-[28px] leading-none numeric text-slate-900 dark:text-slate-50">
                      {formatCurrency(load.loadboard_rate)}
                    </dd>
                  </div>
                  <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                    <MapPin className="h-3 w-3" strokeWidth={1.75} aria-hidden />
                    Posted
                  </span>
                </div>
              </dl>
            </article>
          ))}
        </div>
      )}
    </PageLayout>
  )
}

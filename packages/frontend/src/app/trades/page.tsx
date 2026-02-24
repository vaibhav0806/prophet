'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useTrades, hasSession } from '@/hooks/use-platform-api'
import { formatUSD, truncateAddress, formatRelativeTime } from '@/lib/format'

const PAGE_SIZE = 20

const STATUS_STYLES: Record<string, string> = {
  OPEN: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  PARTIAL: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  FILLED: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  CLOSED: 'bg-gray-700/30 text-gray-400 border-gray-600/30',
  EXPIRED: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
}

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] || STATUS_STYLES.CLOSED
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium uppercase tracking-wide border ${style}`}>
      {status}
    </span>
  )
}

function PnlCell({ pnl }: { pnl: number | null }) {
  if (pnl === null) {
    return <span className="text-gray-600 font-mono tabular-nums">&mdash;</span>
  }
  const display = pnl / 1e6
  const isPositive = display > 0
  const isNegative = display < 0
  return (
    <span className={`font-mono tabular-nums font-medium ${isPositive ? 'text-emerald-400' : isNegative ? 'text-red-400' : 'text-gray-400'}`}>
      {isPositive ? '+' : ''}{formatUSD(display, 2)}
    </span>
  )
}

function SkeletonTable() {
  return (
    <div className="bg-gray-900/50 border border-gray-800/80 rounded-xl overflow-hidden">
      <div className="p-4 border-b border-gray-800/60">
        <div className="flex items-center gap-3">
          <div className="skeleton h-4 w-28" />
          <div className="skeleton h-4 w-16 ml-auto" />
        </div>
      </div>
      <div className="divide-y divide-gray-800/40">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="px-4 py-4 flex items-center gap-4">
            <div className="skeleton h-3 w-24" />
            <div className="skeleton h-5 w-16" />
            <div className="skeleton h-3 w-16" />
            <div className="skeleton h-3 w-16" />
            <div className="skeleton h-3 w-12" />
            <div className="skeleton h-3 w-16 ml-auto" />
            <div className="skeleton h-3 w-14" />
            <div className="skeleton h-3 w-14" />
          </div>
        ))}
      </div>
    </div>
  )
}

export default function TradesPage() {
  const router = useRouter()
  const [offset, setOffset] = useState(0)
  const [allTrades, setAllTrades] = useState<Array<{
    id: string
    marketId: string
    status: string
    legA: unknown
    legB: unknown
    totalCost: number
    expectedPayout: number
    spreadBps: number
    pnl: number | null
    openedAt: string
    closedAt: string | null
  }>>([])

  const { data, isLoading, isFetching } = useTrades(PAGE_SIZE, offset)

  // Auth guard
  useEffect(() => {
    if (typeof window !== 'undefined' && !hasSession()) {
      router.replace('/login')
    }
  }, [router])

  // Accumulate trades for pagination
  useEffect(() => {
    if (!data?.trades) return
    setAllTrades((prev) => {
      if (offset === 0) return data.trades
      const existingIds = new Set(prev.map((t) => t.id))
      const newTrades = data.trades.filter((t) => !existingIds.has(t.id))
      return [...prev, ...newTrades]
    })
  }, [data, offset])

  const hasMore = useMemo(() => {
    if (!data?.trades) return false
    return data.trades.length === PAGE_SIZE
  }, [data])

  const handleLoadMore = () => {
    setOffset((prev) => prev + PAGE_SIZE)
  }

  if (typeof window !== 'undefined' && !hasSession()) return null

  return (
    <div className="p-6 lg:p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Trade History</h1>
          <p className="text-sm text-gray-500 mt-1">
            {allTrades.length > 0 && (
              <span className="font-mono tabular-nums">{allTrades.length}</span>
            )}
            {allTrades.length > 0 ? ' trades loaded' : 'Past arbitrage executions'}
          </p>
        </div>
      </div>

      {isLoading && offset === 0 && <SkeletonTable />}

      {!isLoading && allTrades.length === 0 && (
        <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl p-12 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-800/60 mb-4">
            <svg className="w-6 h-6 text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
            </svg>
          </div>
          <div className="text-gray-400 font-medium">No trades yet</div>
          <div className="text-sm text-gray-600 mt-1">Start the agent to begin executing arbitrage trades</div>
        </div>
      )}

      {allTrades.length > 0 && (
        <div className="bg-gray-900/50 border border-gray-800/80 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800/80 text-[11px] uppercase tracking-wider text-gray-500">
                  <th className="px-4 py-3 text-left font-medium">Market</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Cost</th>
                  <th className="px-4 py-3 text-right font-medium">Expected Payout</th>
                  <th className="px-4 py-3 text-right font-medium">Spread</th>
                  <th className="px-4 py-3 text-right font-medium">P&L</th>
                  <th className="px-4 py-3 text-right font-medium">Opened</th>
                  <th className="px-4 py-3 text-right font-medium">Closed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/40">
                {allTrades.map((trade) => {
                  const openedRel = formatRelativeTime(Math.floor(new Date(trade.openedAt).getTime() / 1000))
                  const closedRel = trade.closedAt
                    ? formatRelativeTime(Math.floor(new Date(trade.closedAt).getTime() / 1000))
                    : null

                  return (
                    <tr key={trade.id} className="transition-colors hover:bg-gray-800/30">
                      <td className="px-4 py-3.5 font-mono text-xs text-gray-400">
                        {truncateAddress(trade.marketId, 6)}
                      </td>
                      <td className="px-4 py-3.5">
                        <StatusBadge status={trade.status} />
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono tabular-nums text-gray-300">
                        {formatUSD(trade.totalCost / 1e6, 2)}
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono tabular-nums text-gray-300">
                        {formatUSD(trade.expectedPayout / 1e6, 2)}
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono tabular-nums text-gray-300">
                        {trade.spreadBps} <span className="text-gray-600">bps</span>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <PnlCell pnl={trade.pnl} />
                      </td>
                      <td className="px-4 py-3.5 text-right text-xs text-gray-400" title={openedRel.full}>
                        {openedRel.relative}
                      </td>
                      <td className="px-4 py-3.5 text-right text-xs text-gray-400" title={closedRel?.full}>
                        {closedRel ? closedRel.relative : <span className="text-gray-600">&mdash;</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Load More */}
          {hasMore && (
            <div className="border-t border-gray-800/60 p-4 flex justify-center">
              <button
                onClick={handleLoadMore}
                disabled={isFetching}
                className="px-5 py-2.5 bg-gray-700/60 hover:bg-gray-600/60 border border-gray-600/40 rounded-lg font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isFetching ? (
                  <span className="flex items-center gap-2">
                    <span className="inline-block w-4 h-4 border-2 border-gray-600 border-t-emerald-400 rounded-full spin-slow" />
                    Loading...
                  </span>
                ) : (
                  'Load More'
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

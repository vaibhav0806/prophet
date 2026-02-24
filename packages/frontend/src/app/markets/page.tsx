'use client'

import { useMemo } from 'react'
import { useMarkets } from '@/hooks/use-platform-api'
import { formatUSD, formatNumber, truncateAddress } from '@/lib/format'

function spreadColor(bps: number): string {
  if (bps >= 200) return 'text-emerald-400'
  if (bps >= 100) return 'text-yellow-400'
  return 'text-gray-400'
}

function SkeletonTable() {
  return (
    <div className="bg-gray-900/50 border border-gray-800/80 rounded-xl overflow-hidden">
      <div className="p-4 border-b border-gray-800/60">
        <div className="flex items-center gap-3">
          <div className="skeleton h-4 w-32" />
          <div className="skeleton h-4 w-20 ml-auto" />
        </div>
      </div>
      <div className="divide-y divide-gray-800/40">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="px-4 py-4 flex items-center gap-4">
            <div className="skeleton h-3 w-24" />
            <div className="skeleton h-5 w-20" />
            <div className="skeleton h-5 w-20" />
            <div className="skeleton h-3 w-14 ml-auto" />
            <div className="skeleton h-3 w-14" />
            <div className="skeleton h-3 w-16" />
            <div className="skeleton h-3 w-16" />
            <div className="skeleton h-3 w-16" />
            <div className="skeleton h-3 w-16" />
          </div>
        ))}
      </div>
    </div>
  )
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-800/30 rounded-lg px-4 py-3">
      <div className="text-[11px] text-gray-500 uppercase tracking-wide mb-1">{label}</div>
      <div className="text-sm font-mono tabular-nums font-medium">{value}</div>
    </div>
  )
}

export default function MarketsPage() {
  const { data, isLoading, dataUpdatedAt } = useMarkets()

  const sorted = useMemo(() => {
    if (!data?.opportunities) return []
    return [...data.opportunities].sort((a, b) => b.spreadBps - a.spreadBps)
  }, [data?.opportunities])

  const avgSpread = useMemo(() => {
    if (sorted.length === 0) return 0
    return sorted.reduce((sum, o) => sum + o.spreadBps, 0) / sorted.length
  }, [sorted])

  const lastScanRelative = useMemo(() => {
    if (!data?.updatedAt) return 'Never'
    const diffMs = Date.now() - data.updatedAt
    const diffSec = Math.floor(diffMs / 1000)
    if (diffSec < 60) return `${diffSec}s ago`
    const diffMin = Math.floor(diffSec / 60)
    if (diffMin < 60) return `${diffMin}m ago`
    const diffHour = Math.floor(diffMin / 60)
    return `${diffHour}h ago`
  }, [data?.updatedAt])

  return (
    <div className="p-6 lg:p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Live Opportunities</h1>
          <p className="text-sm text-gray-500 mt-1">
            {data ? (
              <>
                <span className="font-mono tabular-nums">{data.quoteCount}</span> quotes scanned
              </>
            ) : (
              'Cross-protocol arbitrage detection'
            )}
          </p>
        </div>
        {dataUpdatedAt > 0 && (
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 pulse-dot" />
            Live
          </div>
        )}
      </div>

      {/* Stats Bar */}
      {data && sorted.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <StatBox label="Opportunities" value={String(sorted.length)} />
          <StatBox label="Avg Spread" value={`${formatNumber(avgSpread, 1)} bps`} />
          <StatBox label="Last Scan" value={lastScanRelative} />
        </div>
      )}

      {isLoading && <SkeletonTable />}

      {!isLoading && sorted.length === 0 && (
        <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl p-12 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-800/60 mb-4">
            <svg className="w-6 h-6 text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
          </div>
          <div className="text-gray-400 font-medium">No opportunities found</div>
          <div className="text-sm text-gray-600 mt-1">Scanner may be starting up &mdash; opportunities refresh every 10 seconds</div>
        </div>
      )}

      {sorted.length > 0 && (
        <div className="bg-gray-900/50 border border-gray-800/80 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800/80 text-[11px] uppercase tracking-wider text-gray-500">
                  <th className="px-4 py-3 text-left font-medium">Market</th>
                  <th className="px-4 py-3 text-left font-medium">Protocol A</th>
                  <th className="px-4 py-3 text-left font-medium">Protocol B</th>
                  <th className="px-4 py-3 text-right font-medium">Spread</th>
                  <th className="px-4 py-3 text-right font-medium">Gross Spread</th>
                  <th className="px-4 py-3 text-right font-medium">Est. Profit</th>
                  <th className="px-4 py-3 text-right font-medium">Total Cost</th>
                  <th className="px-4 py-3 text-right font-medium">Liquidity A</th>
                  <th className="px-4 py-3 text-right font-medium">Liquidity B</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/40">
                {sorted.map((opp, i) => {
                  const isBest = i === 0
                  const estProfit = parseFloat(opp.estProfit) / 1e18
                  const totalCost = parseFloat(opp.totalCost) / 1e18
                  const liqA = parseFloat(opp.liquidityA) / 1e18
                  const liqB = parseFloat(opp.liquidityB) / 1e18

                  return (
                    <tr
                      key={`${opp.marketId}-${i}`}
                      className={`
                        transition-colors hover:bg-gray-800/30
                        ${isBest ? 'row-glow' : ''}
                      `}
                    >
                      <td className="px-4 py-3.5 font-mono text-xs text-gray-400">
                        {truncateAddress(opp.marketId, 6)}
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="inline-block px-2 py-0.5 rounded text-xs font-medium border bg-gray-700/30 text-gray-300 border-gray-600/30">
                          {opp.protocolA}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="inline-block px-2 py-0.5 rounded text-xs font-medium border bg-gray-700/30 text-gray-300 border-gray-600/30">
                          {opp.protocolB}
                        </span>
                      </td>
                      <td className={`px-4 py-3.5 text-right font-mono tabular-nums font-semibold ${spreadColor(opp.spreadBps)}`}>
                        {opp.spreadBps} <span className="text-gray-600 font-normal">bps</span>
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono tabular-nums text-gray-300">
                        {opp.grossSpreadBps} <span className="text-gray-600">bps</span>
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono tabular-nums font-semibold text-emerald-400">
                        {formatUSD(estProfit, 2)}
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono tabular-nums text-gray-300">
                        {formatUSD(totalCost, 2)}
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono tabular-nums text-gray-400 text-xs">
                        {formatUSD(liqA, 0)}
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono tabular-nums text-gray-400 text-xs">
                        {formatUSD(liqB, 0)}
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
  )
}

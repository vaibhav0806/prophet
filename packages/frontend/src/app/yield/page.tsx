'use client'

import { useMemo } from 'react'
import { formatUnits } from 'viem'
import { usePositions } from '@/hooks/use-agent-api'
import { useVaultBalance } from '@/hooks/use-vault'
import { ErrorBoundary } from '@/components/error-boundary'
import { YieldSummary } from '@/components/yield/yield-summary'
import { AllocationBar } from '@/components/yield/allocation-bar'

function toNumber(value: string, decimals: number): number {
  try {
    return Number(formatUnits(BigInt(value), decimals))
  } catch {
    return 0
  }
}

function formatOnchain(value: bigint | undefined, decimals = 6, display = 4): string {
  if (value === undefined) return '...'
  try {
    return Number(formatUnits(value, decimals)).toFixed(display)
  } catch {
    return '\u2014'
  }
}

interface ProtocolStats {
  protocol: string
  totalCost: number
  positionCount: number
  openCount: number
  closedCount: number
}

export default function YieldPage() {
  const { data: positions, isLoading, error } = usePositions()
  const { data: vaultBalance } = useVaultBalance()

  const stats = useMemo(() => {
    if (!positions) return null

    // We don't have explicit protocol names on positions, but we can derive
    // from marketId patterns. For now, group by position direction as a proxy
    // since the API positions don't carry protocol names directly.
    // We'll use a generic grouping approach.
    const byProtocol = new Map<string, ProtocolStats>()
    let totalDeployed = 0
    let activeCount = 0

    for (const pos of positions) {
      const cost = toNumber(pos.costA, 6) + toNumber(pos.costB, 6)
      totalDeployed += cost
      if (!pos.closed) activeCount++

      // Group by direction as a proxy label
      const label = pos.boughtYesOnA ? 'YES-A / NO-B' : 'NO-A / YES-B'
      const existing = byProtocol.get(label) || {
        protocol: label,
        totalCost: 0,
        positionCount: 0,
        openCount: 0,
        closedCount: 0,
      }
      existing.totalCost += cost
      existing.positionCount++
      if (pos.closed) existing.closedCount++
      else existing.openCount++
      byProtocol.set(label, existing)
    }

    // Weighted average yield: for closed positions, assume 1 USDT payout per share pair
    // PnL = (closed positions * guaranteed payout) - total cost of closed positions
    let closedCost = 0
    let closedPayout = 0
    for (const pos of positions) {
      if (pos.closed) {
        const cost = toNumber(pos.costA, 6) + toNumber(pos.costB, 6)
        closedCost += cost
        // Guaranteed payout is min(sharesA, sharesB) since one side always wins
        const sharesA = toNumber(pos.sharesA, 6)
        const sharesB = toNumber(pos.sharesB, 6)
        closedPayout += Math.min(sharesA, sharesB)
      }
    }

    const totalPnl = closedPayout - closedCost
    const weightedAvgYield = totalDeployed > 0 ? (totalPnl / totalDeployed) * 100 : 0

    const segments = Array.from(byProtocol.values()).map((s) => ({
      protocol: s.protocol,
      amount: s.totalCost,
      color: '',
    }))

    return {
      totalDeployed,
      totalPnl,
      weightedAvgYield,
      activePositions: activeCount,
      segments,
      byProtocol: Array.from(byProtocol.values()),
    }
  }, [positions])

  return (
    <ErrorBoundary>
      <div>
        <h1 className="text-2xl font-bold mb-6">Yield Dashboard</h1>

        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 mb-6">
          <div className="text-sm text-gray-400">Vault Balance</div>
          <div className="text-2xl font-mono font-bold text-emerald-400">
            {formatOnchain(vaultBalance as bigint | undefined)} USDT
          </div>
        </div>

        {isLoading && (
          <div className="text-gray-400 animate-pulse">Loading yield data...</div>
        )}

        {error && (
          <div className="text-red-400 bg-red-950/50 border border-red-900 rounded-lg p-4">
            Failed to load positions: {(error as Error).message}
          </div>
        )}

        {positions && positions.length === 0 && (
          <div className="text-gray-500 bg-gray-900 border border-gray-800 rounded-lg p-8 text-center">
            No positions to calculate yield from
          </div>
        )}

        {stats && positions && positions.length > 0 && (
          <div className="space-y-6">
            <YieldSummary
              totalDeployed={stats.totalDeployed}
              totalPnl={stats.totalPnl}
              weightedAvgYield={stats.weightedAvgYield}
              activePositions={stats.activePositions}
            />

            <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
              <h2 className="text-lg font-semibold mb-4">Capital Allocation</h2>
              <AllocationBar
                segments={stats.segments}
                total={stats.totalDeployed}
              />
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
              <h2 className="text-lg font-semibold mb-4">Positions by Strategy</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800 text-gray-400 text-left">
                      <th className="pb-3 pr-4">Strategy</th>
                      <th className="pb-3 pr-4 text-right">Total Cost</th>
                      <th className="pb-3 pr-4 text-right">Positions</th>
                      <th className="pb-3 pr-4 text-right">Open</th>
                      <th className="pb-3 text-right">Closed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.byProtocol.map((row) => (
                      <tr
                        key={row.protocol}
                        className="border-b border-gray-800/50 hover:bg-gray-900/50 transition-colors"
                      >
                        <td className="py-3 pr-4 font-medium">{row.protocol}</td>
                        <td className="py-3 pr-4 text-right font-mono">{row.totalCost.toFixed(4)}</td>
                        <td className="py-3 pr-4 text-right font-mono">{row.positionCount}</td>
                        <td className="py-3 pr-4 text-right font-mono">{row.openCount}</td>
                        <td className="py-3 text-right font-mono">{row.closedCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
              <h2 className="text-lg font-semibold mb-4">Returns Summary</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                <div>
                  <div className="text-gray-500 mb-1">Total Invested</div>
                  <div className="font-mono font-medium">{stats.totalDeployed.toFixed(4)} USDT</div>
                </div>
                <div>
                  <div className="text-gray-500 mb-1">Realized P&L</div>
                  <div className={`font-mono font-medium ${stats.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {stats.totalPnl >= 0 ? '+' : ''}{stats.totalPnl.toFixed(4)} USDT
                  </div>
                </div>
                <div>
                  <div className="text-gray-500 mb-1">Return on Capital</div>
                  <div className={`font-mono font-medium ${stats.weightedAvgYield >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {stats.weightedAvgYield.toFixed(2)}%
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </ErrorBoundary>
  )
}

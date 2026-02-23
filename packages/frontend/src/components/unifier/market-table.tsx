'use client'

import { formatUnits } from 'viem'
import { Opportunity } from '@/hooks/use-agent-api'

function formatValue(value: string, decimals: number, display = 4): string {
  try {
    return Number(formatUnits(BigInt(value), decimals)).toFixed(display)
  } catch {
    return '\u2014'
  }
}

function truncate(hex: string, chars = 8): string {
  if (hex.length <= chars * 2 + 2) return hex
  return `${hex.slice(0, chars + 2)}...${hex.slice(-chars)}`
}

function spreadColor(bps: number): string {
  if (bps > 200) return 'text-emerald-400'
  if (bps >= 100) return 'text-yellow-400'
  return 'text-red-400'
}

interface MarketTableProps {
  opportunities: Opportunity[]
  protocolFilter: string
  matchFilter: 'all' | 'matched' | 'unmatched'
  sortBySpread: boolean
}

export function MarketTable({
  opportunities,
  protocolFilter,
  matchFilter,
  sortBySpread,
}: MarketTableProps) {
  // Group opportunities by marketId to find matched pairs (same market across protocols)
  const marketGroups = new Map<string, Opportunity[]>()
  for (const opp of opportunities) {
    const key = opp.marketId
    const group = marketGroups.get(key) || []
    group.push(opp)
    marketGroups.set(key, group)
  }

  let filtered = opportunities.filter((opp) => {
    if (protocolFilter && opp.protocolA !== protocolFilter && opp.protocolB !== protocolFilter) {
      return false
    }
    const group = marketGroups.get(opp.marketId) || []
    const isMatched = group.length > 1 || (opp.protocolA !== opp.protocolB)
    if (matchFilter === 'matched' && !isMatched) return false
    if (matchFilter === 'unmatched' && isMatched) return false
    return true
  })

  if (sortBySpread) {
    filtered = [...filtered].sort((a, b) => b.spreadBps - a.spreadBps)
  }

  if (filtered.length === 0) {
    return (
      <div className="text-gray-500 bg-gray-900 border border-gray-800 rounded-lg p-8 text-center">
        No markets match filters
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-800 text-gray-400 text-left">
            <th className="pb-3 pr-4">Market</th>
            <th className="pb-3 pr-4">Protocol A</th>
            <th className="pb-3 pr-4">Protocol B</th>
            <th className="pb-3 pr-4 text-right">YES Price A</th>
            <th className="pb-3 pr-4 text-right">NO Price B</th>
            <th className="pb-3 pr-4 text-right">Spread (bps)</th>
            <th className="pb-3 pr-4 text-right">Est. Profit</th>
            <th className="pb-3 text-right">Status</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((opp, i) => {
            const isMatched = opp.protocolA !== opp.protocolB
            return (
              <tr
                key={`${opp.marketId}-${i}`}
                className="border-b border-gray-800/50 hover:bg-gray-900/50 transition-colors"
              >
                <td className="py-3 pr-4 font-mono text-xs">{truncate(opp.marketId)}</td>
                <td className="py-3 pr-4">
                  <span className="inline-block px-2 py-0.5 rounded text-xs bg-gray-800 text-gray-300">
                    {opp.protocolA}
                  </span>
                </td>
                <td className="py-3 pr-4">
                  <span className="inline-block px-2 py-0.5 rounded text-xs bg-gray-800 text-gray-300">
                    {opp.protocolB}
                  </span>
                </td>
                <td className="py-3 pr-4 text-right font-mono">{formatValue(opp.yesPriceA, 18)}</td>
                <td className="py-3 pr-4 text-right font-mono">{formatValue(opp.noPriceB, 18)}</td>
                <td className={`py-3 pr-4 text-right font-mono font-semibold ${spreadColor(opp.spreadBps)}`}>
                  {opp.spreadBps}
                </td>
                <td className="py-3 pr-4 text-right font-mono text-emerald-400">
                  {formatValue(opp.estProfit, 6)}
                </td>
                <td className="py-3 text-right">
                  {isMatched ? (
                    <span className="inline-block px-2 py-0.5 rounded text-xs bg-emerald-950 text-emerald-400">
                      Matched
                    </span>
                  ) : (
                    <span className="inline-block px-2 py-0.5 rounded text-xs bg-gray-800 text-gray-500">
                      Single
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

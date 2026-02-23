'use client'

import { useState, useMemo } from 'react'
import { useOpportunities } from '@/hooks/use-agent-api'
import { ErrorBoundary } from '@/components/error-boundary'
import { MarketTable } from '@/components/unifier/market-table'

export default function UnifierPage() {
  const { data: opportunities, isLoading, error } = useOpportunities()
  const [protocolFilter, setProtocolFilter] = useState('')
  const [matchFilter, setMatchFilter] = useState<'all' | 'matched' | 'unmatched'>('all')
  const [sortBySpread, setSortBySpread] = useState(true)

  const protocols = useMemo(() => {
    if (!opportunities) return []
    const set = new Set<string>()
    for (const opp of opportunities) {
      set.add(opp.protocolA)
      set.add(opp.protocolB)
    }
    return Array.from(set).sort()
  }, [opportunities])

  return (
    <ErrorBoundary>
      <div>
        <h1 className="text-2xl font-bold mb-6">Market Unifier</h1>

        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 mb-6">
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Protocol</label>
              <select
                value={protocolFilter}
                onChange={(e) => setProtocolFilter(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-emerald-600"
              >
                <option value="">All Protocols</option>
                {protocols.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Match Status</label>
              <select
                value={matchFilter}
                onChange={(e) => setMatchFilter(e.target.value as 'all' | 'matched' | 'unmatched')}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-emerald-600"
              >
                <option value="all">All</option>
                <option value="matched">Matched Only</option>
                <option value="unmatched">Unmatched Only</option>
              </select>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sortBySpread}
                  onChange={(e) => setSortBySpread(e.target.checked)}
                  className="rounded bg-gray-800 border-gray-700 text-emerald-600 focus:ring-emerald-600"
                />
                Sort by spread
              </label>
            </div>
          </div>
        </div>

        {isLoading && (
          <div className="text-gray-400 animate-pulse">Loading markets...</div>
        )}

        {error && (
          <div className="text-red-400 bg-red-950/50 border border-red-900 rounded-lg p-4">
            Failed to load markets: {(error as Error).message}
          </div>
        )}

        {opportunities && opportunities.length === 0 && (
          <div className="text-gray-500 bg-gray-900 border border-gray-800 rounded-lg p-8 text-center">
            No markets found across protocols
          </div>
        )}

        {opportunities && opportunities.length > 0 && (
          <MarketTable
            opportunities={opportunities}
            protocolFilter={protocolFilter}
            matchFilter={matchFilter}
            sortBySpread={sortBySpread}
          />
        )}
      </div>
    </ErrorBoundary>
  )
}

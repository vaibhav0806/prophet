'use client'

import { useState } from 'react'
import { usePositions } from '@/hooks/use-agent-api'
import { ErrorBoundary } from '@/components/error-boundary'
import { TradeLog } from '@/components/audit/trade-log'

export default function AuditPage() {
  const { data: positions, isLoading, error } = usePositions()
  const [actionFilter, setActionFilter] = useState<'all' | 'open' | 'closed'>('all')

  return (
    <ErrorBoundary>
      <div>
        <h1 className="text-2xl font-bold mb-6">Audit Trail</h1>

        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 mb-6">
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Action</label>
              <select
                value={actionFilter}
                onChange={(e) => setActionFilter(e.target.value as 'all' | 'open' | 'closed')}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-emerald-600"
              >
                <option value="all">All Actions</option>
                <option value="open">Open Only</option>
                <option value="closed">Closed Only</option>
              </select>
            </div>
            {positions && (
              <div className="ml-auto text-sm text-gray-500">
                {positions.length} total trade{positions.length !== 1 ? 's' : ''}
              </div>
            )}
          </div>
        </div>

        {isLoading && (
          <div className="text-gray-400 animate-pulse">Loading trade history...</div>
        )}

        {error && (
          <div className="text-red-400 bg-red-950/50 border border-red-900 rounded-lg p-4">
            Failed to load trade history: {(error as Error).message}
          </div>
        )}

        {positions && positions.length === 0 && (
          <div className="text-gray-500 bg-gray-900 border border-gray-800 rounded-lg p-8 text-center">
            No trades recorded yet. The agent has not executed any trades.
          </div>
        )}

        {positions && positions.length > 0 && (
          <TradeLog positions={positions} actionFilter={actionFilter} />
        )}
      </div>
    </ErrorBoundary>
  )
}

'use client'

interface YieldSummaryProps {
  totalDeployed: number
  totalPnl: number
  weightedAvgYield: number
  activePositions: number
}

export function YieldSummary({
  totalDeployed,
  totalPnl,
  weightedAvgYield,
  activePositions,
}: YieldSummaryProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <div className="text-sm text-gray-500 mb-1">Total Deployed</div>
        <div className="text-xl font-mono font-bold">{totalDeployed.toFixed(2)} USDT</div>
      </div>
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <div className="text-sm text-gray-500 mb-1">Total P&L</div>
        <div className={`text-xl font-mono font-bold ${totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          {totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(2)} USDT
        </div>
      </div>
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <div className="text-sm text-gray-500 mb-1">Weighted Avg Yield</div>
        <div className={`text-xl font-mono font-bold ${weightedAvgYield >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          {weightedAvgYield.toFixed(2)}%
        </div>
      </div>
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <div className="text-sm text-gray-500 mb-1">Active Positions</div>
        <div className="text-xl font-mono font-bold">{activePositions}</div>
      </div>
    </div>
  )
}

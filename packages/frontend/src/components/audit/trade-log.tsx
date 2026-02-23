'use client'

import { useState } from 'react'
import { formatUnits } from 'viem'
import { Position } from '@/hooks/use-agent-api'

function formatValue(value: string, decimals: number, display = 4): string {
  try {
    return Number(formatUnits(BigInt(value), decimals)).toFixed(display)
  } catch {
    return '\u2014'
  }
}

function truncate(hex: string, chars = 6): string {
  if (hex.length <= chars * 2 + 2) return hex
  return `${hex.slice(0, chars + 2)}...${hex.slice(-chars)}`
}

function formatTimestamp(ts: number): string {
  return new Date(ts * 1000).toLocaleString()
}

interface TradeLogProps {
  positions: Position[]
  actionFilter: 'all' | 'open' | 'closed'
}

export function TradeLog({ positions, actionFilter }: TradeLogProps) {
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const filtered = positions
    .filter((pos) => {
      if (actionFilter === 'open') return !pos.closed
      if (actionFilter === 'closed') return pos.closed
      return true
    })
    .sort((a, b) => b.openedAt - a.openedAt)

  if (filtered.length === 0) {
    return (
      <div className="text-gray-500 bg-gray-900 border border-gray-800 rounded-lg p-8 text-center">
        No trades match filters
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-800 text-gray-400 text-left">
            <th className="pb-3 pr-4">Time</th>
            <th className="pb-3 pr-4">Action</th>
            <th className="pb-3 pr-4">Position</th>
            <th className="pb-3 pr-4">Direction</th>
            <th className="pb-3 pr-4 text-right">Cost A</th>
            <th className="pb-3 pr-4 text-right">Cost B</th>
            <th className="pb-3 pr-4 text-right">Total Cost</th>
            <th className="pb-3 text-right">Status</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((pos) => {
            const totalCost = (BigInt(pos.costA) + BigInt(pos.costB)).toString()
            const isExpanded = expandedId === pos.positionId
            return (
              <TradeRow
                key={pos.positionId}
                pos={pos}
                totalCost={totalCost}
                isExpanded={isExpanded}
                onToggle={() =>
                  setExpandedId(isExpanded ? null : pos.positionId)
                }
              />
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function TradeRow({
  pos,
  totalCost,
  isExpanded,
  onToggle,
}: {
  pos: Position
  totalCost: string
  isExpanded: boolean
  onToggle: () => void
}) {
  return (
    <>
      <tr
        className="border-b border-gray-800/50 hover:bg-gray-900/50 transition-colors cursor-pointer"
        onClick={onToggle}
      >
        <td className="py-3 pr-4 text-xs">{formatTimestamp(pos.openedAt)}</td>
        <td className="py-3 pr-4">
          <span
            className={`inline-block px-2 py-0.5 rounded text-xs ${
              pos.closed
                ? 'bg-emerald-950 text-emerald-400'
                : 'bg-blue-950 text-blue-400'
            }`}
          >
            {pos.closed ? 'Close' : 'Open'}
          </span>
        </td>
        <td className="py-3 pr-4 font-mono text-xs">#{pos.positionId}</td>
        <td className="py-3 pr-4 text-xs">
          {pos.boughtYesOnA ? 'YES on A / NO on B' : 'NO on A / YES on B'}
        </td>
        <td className="py-3 pr-4 text-right font-mono">{formatValue(pos.costA, 6)}</td>
        <td className="py-3 pr-4 text-right font-mono">{formatValue(pos.costB, 6)}</td>
        <td className="py-3 pr-4 text-right font-mono font-medium">{formatValue(totalCost, 6)}</td>
        <td className="py-3 text-right">
          <span className="text-gray-500 text-xs">{isExpanded ? '\u25B2' : '\u25BC'}</span>
        </td>
      </tr>
      {isExpanded && (
        <tr className="border-b border-gray-800/50">
          <td colSpan={8} className="py-3 px-4 bg-gray-900/30">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-xs">
              <div>
                <span className="text-gray-500">Market A</span>
                <div className="font-mono mt-0.5">{truncate(pos.marketIdA)}</div>
              </div>
              <div>
                <span className="text-gray-500">Market B</span>
                <div className="font-mono mt-0.5">{truncate(pos.marketIdB)}</div>
              </div>
              <div>
                <span className="text-gray-500">Shares A</span>
                <div className="font-mono mt-0.5">{formatValue(pos.sharesA, 6)}</div>
              </div>
              <div>
                <span className="text-gray-500">Shares B</span>
                <div className="font-mono mt-0.5">{formatValue(pos.sharesB, 6)}</div>
              </div>
              <div>
                <span className="text-gray-500">Opened At</span>
                <div className="font-mono mt-0.5">{formatTimestamp(pos.openedAt)}</div>
              </div>
              <div>
                <span className="text-gray-500">BscScan</span>
                <div className="mt-0.5">
                  <a
                    href={`https://bscscan.com/address/${pos.marketIdA.slice(0, 42)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-emerald-400 hover:text-emerald-300 underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    View on BscScan
                  </a>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
